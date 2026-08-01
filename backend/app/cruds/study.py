"""
Запити до бази для розділу навчання.

Роути лишаються тонкими: тут вибірка черги, лічильники дня і запис
StudyDayModel. Математики планувальника тут немає — вона в
app/services/scheduler.py.
"""

from datetime import date, datetime
from typing import Sequence

from sqlalchemy import and_, distinct, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.models import (
    CardListLinkModel,
    CardModel,
    ReviewKindEnum,
    ReviewLogModel,
    ReviewStateEnum,
    ReviewTrackModel,
    StudyDayModel,
    UserSettingsModel,
    WordFormModel,
    WordSenseModel,
)


async def get_user_settings(db: AsyncSession, user_id: int) -> UserSettingsModel:
    """
    Налаштування створюються разом із користувачем (routes/accounts.py), тож
    рядок мусить бути. Читаємо окремим SELECT, а не через current_user.settings:
    звернення до лінивої relationship у persistent-об'єкта поза eager-load
    падає з MissingGreenlet.
    """
    stmt = select(UserSettingsModel).where(UserSettingsModel.user_id == user_id)
    return (await db.execute(stmt)).scalars().one()


async def get_own_track_for_update(
    db: AsyncSession, track_id: int, user_id: int
) -> ReviewTrackModel | None:
    """
    Доріжка користувача, заблокована до кінця транзакції.

    FOR UPDATE потрібен, щоб дві одночасні відповіді на ту саму доріжку не
    перезаписали стан одна одної.
    """
    stmt = (
        select(ReviewTrackModel)
        .join(CardModel, ReviewTrackModel.card_id == CardModel.id)
        .where(ReviewTrackModel.id == track_id, CardModel.user_id == user_id)
        .with_for_update(of=ReviewTrackModel)
    )
    return (await db.execute(stmt)).scalars().first()


def _queue_conditions(
    user_id: int,
    list_ids: Sequence[int] | None,
    now: datetime,
    unlisted: bool = False,
):
    """
    Спільний фільтр черги для вибірки і для лічильників — щоб число «705
    карток на повторення» не розходилося з тим, що реально прийде.

    Доріжка FORMS показується лише коли в картки справді є форми і тренування
    форм не вимкнене. Саму доріжку при цьому ніхто не видаляє: вимкнув на
    місяць — прогрес чекає (див. HANDOFF, розділ 2).

    `unlisted` — це «Без списку» як ще одна група поруч зі списками, а не
    режим. Тому він додається В АБО до list_ids, а не звужує їх: вибір «Фрази
    + без списку» означає рівно те, що написано, і має віддати обидві купки.
    Порожній вибір (ні списків, ні прапорця) фільтра не ставить узагалі — це
    вся черга, включно з картками без списку.
    """
    conditions = [
        CardModel.user_id == user_id,
        ReviewTrackModel.due_at <= now,
        or_(
            ReviewTrackModel.kind == ReviewKindEnum.TRANSLATION,
            and_(
                CardModel.forms_drill_enabled.is_(True),
                exists().where(WordFormModel.card_id == CardModel.id),
            ),
        ),
    ]

    groups = []
    if list_ids:
        groups.append(
            exists().where(
                and_(
                    CardListLinkModel.card_id == CardModel.id,
                    CardListLinkModel.list_id.in_(list_ids),
                )
            )
        )
    if unlisted:
        groups.append(~exists().where(CardListLinkModel.card_id == CardModel.id))
    if groups:
        conditions.append(or_(*groups))

    return conditions


async def count_queue(
    db: AsyncSession,
    user_id: int,
    list_ids: Sequence[int] | None,
    now: datetime,
    unlisted: bool = False,
) -> tuple[int, int]:
    """Скільки всього чекає: (прострочені повторення, нові). Одним запитом."""
    stmt = (
        select(
            func.count().filter(ReviewTrackModel.state != ReviewStateEnum.NEW),
            func.count().filter(ReviewTrackModel.state == ReviewStateEnum.NEW),
        )
        .select_from(ReviewTrackModel)
        .join(CardModel, ReviewTrackModel.card_id == CardModel.id)
        .where(*_queue_conditions(user_id, list_ids, now, unlisted))
    )
    due_count, new_count = (await db.execute(stmt)).one()
    return due_count, new_count


async def fetch_queue(
    db: AsyncSession,
    user_id: int,
    list_ids: Sequence[int] | None,
    now: datetime,
    limit: int,
    unlisted: bool = False,
) -> Sequence[ReviewTrackModel]:
    """
    Порція черги.

    Порядок: спершу прострочені повторення, потім нові — всередині кожної
    групи випадково. Затримка нового слова не коштує нічого, бо його ще ніхто
    не пам'ятає; затримка простроченого повторення коштує стабільності.

    OFFSET свідомо немає. Кожна відповідь виштовхує доріжку з черги (due_at
    їде в майбутнє), тож черга коротшає під час сесії і зсунуті сторінки
    пропускали б картки. Фронтенд щоразу питає перші N.
    """
    stmt = (
        select(ReviewTrackModel)
        .join(CardModel, ReviewTrackModel.card_id == CardModel.id)
        .where(*_queue_conditions(user_id, list_ids, now, unlisted))
        .options(
            selectinload(ReviewTrackModel.card)
            .selectinload(CardModel.senses)
            .selectinload(WordSenseModel.examples),
            selectinload(ReviewTrackModel.card).selectinload(CardModel.forms),
        )
        .order_by(ReviewTrackModel.state == ReviewStateEnum.NEW, func.random())
        .limit(limit)
    )
    return (await db.execute(stmt)).scalars().all()


async def ensure_study_day(
    db: AsyncSession,
    user_id: int,
    day: date,
    new_goal: int,
    review_goal: int,
) -> None:
    """
    Зафіксувати, які цілі діяли цього дня.

    Робиться жадібно, при першій же дії доби, і навмисно нічого не рахує.
    Якби рядок створювався заднім числом, у нього потрапили б ПОТОЧНІ цілі:
    підняв ціль з 30 до 50 — і вчорашній день, який був виконаний, назавжди
    став би невиконаним. ON CONFLICT DO NOTHING саме тому, що перший запис дня
    і є правильним.
    """
    stmt = (
        pg_insert(StudyDayModel)
        .values(
            user_id=user_id,
            day=day,
            new_goal=new_goal,
            review_goal=review_goal,
            is_goal_met=False,
        )
        .on_conflict_do_nothing(constraint="uq_study_days_user_day")
    )
    await db.execute(stmt)


async def retarget_study_day(
    db: AsyncSession,
    user_id: int,
    day: date,
    new_goal: int,
    review_goal: int,
) -> None:
    """
    Переписати цілі ОДНОГО дня — того, який ще триває (ADR-0023).

    Пара до `ensure_study_day`, і разом вони й дають правило: минулий день
    зберігає цілі, що діяли тоді, а сьогоднішній живе до півночі й іде за
    поточними. Викликається лише зі зміни налаштувань і лише на сьогодні —
    сусіднього дня ця функція торкнутись не вміє за побудовою.

    `is_goal_met` скидається навмисно, а не лишається як є. Виконання рахують
    /today/ і /days/, і рахують вони тільки НЕзакриті дні; лишити прапорець
    True означало б, що піднята ціль ніколи не перерахується. Скинутий
    прапорець наступне ж читання поверне на місце, якщо ціль усе ще виконана.

    Рядка може й не бути — тоді нічого не робимо: його створить перша дія доби,
    і вже з новими цілями.
    """
    stmt = (
        update(StudyDayModel)
        .where(StudyDayModel.user_id == user_id, StudyDayModel.day == day)
        .values(new_goal=new_goal, review_goal=review_goal, is_goal_met=False)
    )
    await db.execute(stmt)


async def get_study_day(
    db: AsyncSession, user_id: int, day: date
) -> StudyDayModel | None:
    stmt = select(StudyDayModel).where(
        StudyDayModel.user_id == user_id, StudyDayModel.day == day
    )
    return (await db.execute(stmt)).scalars().first()


async def get_open_study_days(
    db: AsyncSession, user_id: int, until: date
) -> Sequence[StudyDayModel]:
    """
    Дні, які ще не закриті. Закритий день назад не переглядається — is_goal_met
    це зафіксований факт, а не поточний стан.
    """
    stmt = (
        select(StudyDayModel)
        .where(
            StudyDayModel.user_id == user_id,
            StudyDayModel.is_goal_met.is_(False),
            StudyDayModel.day <= until,
        )
        .order_by(StudyDayModel.day)
    )
    return (await db.execute(stmt)).scalars().all()


async def count_reviewed_tracks(
    db: AsyncSession, user_id: int, start: datetime, end: datetime
) -> int:
    """
    Скільки РІЗНИХ доріжок повторено за добу.

    Саме DISTINCT, а не кількість відповідей: із кроками навчання одна доріжка
    дає 2-3 записи в review_logs за день, і COUNT(*) зробив би зміст цифри «30»
    залежним від налаштувань планувальника.
    """
    stmt = select(func.count(distinct(ReviewLogModel.track_id))).where(
        ReviewLogModel.user_id == user_id,
        ReviewLogModel.reviewed_at >= start,
        ReviewLogModel.reviewed_at < end,
    )
    return (await db.execute(stmt)).scalar_one()


async def count_created_cards(
    db: AsyncSession, user_id: int, start: datetime, end: datetime
) -> int:
    """
    Скільки слів ДОДАНО за добу. Ціль нових — про поповнення словника, а не про
    показ карток, тож рахується з cards.created_at.
    """
    stmt = select(func.count(CardModel.id)).where(
        CardModel.user_id == user_id,
        CardModel.created_at >= start,
        CardModel.created_at < end,
    )
    return (await db.execute(stmt)).scalar_one()


def _local_date(column, tz_name: str):
    """
    Момент у UTC → дата в поясі користувача, силами Postgres.

    `timestamptz AT TIME ZONE 'Europe/Kyiv'` дає локальний timestamp, з якого
    ::date і є «доба користувача». Перехід на літній час Postgres враховує сам,
    так само як local_day_bounds у Python — test_day_counts.py пришпилює їх
    одне до одного, щоб ці дві реалізації не розійшлися.

    tz_name сюди мусить приходити ВЖЕ розвʼязаним через resolve_timezone:
    user_settings.timezone — вільний String(64), і сміття з нього Postgres
    зустріне помилкою invalid_parameter_value, а не тихим дефолтом.
    """
    return func.date(func.timezone(tz_name, column))


async def count_new_cards_by_day(
    db: AsyncSession,
    user_id: int,
    tz_name: str,
    start: datetime,
    end: datetime,
) -> dict[date, int]:
    """Скільки слів додано кожної доби діапазону. Дні без жодного — відсутні."""
    day = _local_date(CardModel.created_at, tz_name).label("day")
    stmt = (
        select(day, func.count(CardModel.id))
        .where(
            CardModel.user_id == user_id,
            CardModel.created_at >= start,
            CardModel.created_at < end,
        )
        .group_by(day)
    )
    return {row_day: count for row_day, count in (await db.execute(stmt)).all()}


async def count_reviewed_tracks_by_day(
    db: AsyncSession,
    user_id: int,
    tz_name: str,
    start: datetime,
    end: datetime,
) -> dict[date, int]:
    """
    Скільки РІЗНИХ доріжок повторено кожної доби діапазону.

    DISTINCT з тієї самої причини, що й у count_reviewed_tracks: із кроками
    навчання одна доріжка дає 2-3 записи за день, і COUNT(*) зробив би зміст
    цифри «30» залежним від налаштувань планувальника.
    """
    day = _local_date(ReviewLogModel.reviewed_at, tz_name).label("day")
    stmt = (
        select(day, func.count(distinct(ReviewLogModel.track_id)))
        .where(
            ReviewLogModel.user_id == user_id,
            ReviewLogModel.reviewed_at >= start,
            ReviewLogModel.reviewed_at < end,
        )
        .group_by(day)
    )
    return {row_day: count for row_day, count in (await db.execute(stmt)).all()}


async def get_study_days(
    db: AsyncSession,
    user_id: int,
    date_from: date | None,
    date_to: date | None,
) -> Sequence[StudyDayModel]:
    """
    Дні навчання за діапазон, старіші зверху. Межі включні, обидві необовʼязкові:
    без них віддається вся історія — саме так екран прогресу рахує «за весь час».
    """
    conditions = [StudyDayModel.user_id == user_id]
    if date_from is not None:
        conditions.append(StudyDayModel.day >= date_from)
    if date_to is not None:
        conditions.append(StudyDayModel.day <= date_to)

    stmt = select(StudyDayModel).where(*conditions).order_by(StudyDayModel.day)
    return (await db.execute(stmt)).scalars().all()
