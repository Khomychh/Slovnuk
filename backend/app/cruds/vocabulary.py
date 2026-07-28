"""
Запити до бази для словника.

Тут вибірка карток і списків та лічильники. Логіки збереження картки тут немає —
вона в app/services/vocabulary.py, щоб її можна було перевірити без бази.
"""

from datetime import datetime
from typing import Sequence

from sqlalchemy import Select, and_, case, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.cruds.study import _queue_conditions
from app.database.models import (
    CardListLinkModel,
    CardModel,
    ReviewKindEnum,
    ReviewStateEnum,
    ReviewTrackModel,
    WordFormModel,
    WordListModel,
    WordSenseModel,
    normalize_word,
)

# Картка їде назовні цілком, тож підвантажуємо все, з чого її збирає CardSchema.
CARD_LOADERS = (
    selectinload(CardModel.senses).selectinload(WordSenseModel.examples),
    selectinload(CardModel.forms),
    selectinload(CardModel.review_tracks),
    selectinload(CardModel.list_links),
)


# --------------------------------------------------------------------------
# Картки
# --------------------------------------------------------------------------


def card_filters(
    user_id: int,
    list_id: int | None,
    unlisted: bool,
    query: str | None,
    word: str | None,
) -> list:
    conditions = [CardModel.user_id == user_id]

    if list_id is not None:
        conditions.append(
            exists().where(
                and_(
                    CardListLinkModel.card_id == CardModel.id,
                    CardListLinkModel.list_id == list_id,
                )
            )
        )

    if unlisted:
        # «Без списку» — це відсутність зв'язків, а не окремий список, тож і
        # питається воно як відсутність рядків у card_list_links.
        conditions.append(
            ~exists().where(CardListLinkModel.card_id == CardModel.id)
        )

    if word:
        conditions.append(CardModel.word_normalized == normalize_word(word))

    if query:
        pattern = f"%{normalize_word(query)}%"
        conditions.append(
            or_(
                CardModel.word_normalized.like(pattern),
                exists().where(
                    and_(
                        WordSenseModel.card_id == CardModel.id,
                        func.lower(WordSenseModel.translation).like(pattern),
                    )
                ),
                # Форми шукаються разом зі словом навмисно: 143 зі 157 форм
                # словника не є підрядком свого слова (woke, given, brought),
                # тож без цього картку не знайти за формою, яку щойно зустрів у
                # тексті. Старий PWA це вмів (cardSearchText).
                exists().where(
                    and_(
                        WordFormModel.card_id == CardModel.id,
                        func.lower(WordFormModel.value).like(pattern),
                    )
                ),
            )
        )

    return conditions


async def count_cards(db: AsyncSession, conditions: Sequence) -> int:
    stmt = select(func.count(CardModel.id)).where(*conditions)
    return (await db.execute(stmt)).scalar_one()


def card_order(sort: str):
    """
    Порядок сторінки словника.

    `created` — новіші зверху, як у старому PWA. Після імпорту він вироджується:
    ADR-0004 не переносить дат, тож у всіх карток однаковий `created_at` і
    фактичний порядок задає `id`. Власник це прийняв свідомо — з часом дати
    розходяться самі.

    `word` — за нормалізованим словом, тобто тим самим, за яким шукає `?q=`, а
    не за сирим `word`: інакше «Apple» стояло б перед «apple» у сортуванні, але
    збігалося б у пошуку.

    Другий ключ `id` є завжди: без нього рядки з однаковим значенням першого
    ключа можуть мінятись місцями між сторінками, і при зсувній пагінації
    картка або продублюється, або зникне.
    """
    if sort == "word":
        return (CardModel.word_normalized.asc(), CardModel.id.asc())
    return (CardModel.created_at.desc(), CardModel.id.desc())


async def fetch_cards(
    db: AsyncSession,
    conditions: Sequence,
    limit: int,
    offset: int,
    sort: str = "created",
) -> Sequence[CardModel]:
    """
    Сторінка словника.

    Зсувна пагінація тут безпечна, на відміну від черги: рядки словника під час
    перегляду нікуди не діваються, тож сторінки не з'їжджають.
    """
    stmt: Select = (
        select(CardModel)
        .where(*conditions)
        .options(*CARD_LOADERS)
        .order_by(*card_order(sort))
        .limit(limit)
        .offset(offset)
    )
    return (await db.execute(stmt)).scalars().all()


async def get_own_card(
    db: AsyncSession, card_id: int, user_id: int
) -> CardModel | None:
    stmt = (
        select(CardModel)
        .where(CardModel.id == card_id, CardModel.user_id == user_id)
        .options(*CARD_LOADERS)
    )
    return (await db.execute(stmt)).scalars().first()


async def find_card_by_word(
    db: AsyncSession, user_id: int, word: str
) -> CardModel | None:
    """Картка з таким самим нормалізованим словом — джерело 409 при створенні."""
    stmt = select(CardModel).where(
        CardModel.user_id == user_id,
        CardModel.word_normalized == normalize_word(word),
    )
    return (await db.execute(stmt)).scalars().first()


async def load_card(db: AsyncSession, card_id: int) -> CardModel:
    """Перечитати картку з усіма дітьми — для відповіді після запису."""
    stmt = select(CardModel).where(CardModel.id == card_id).options(*CARD_LOADERS)
    return (await db.execute(stmt)).scalars().one()


# --------------------------------------------------------------------------
# Списки
# --------------------------------------------------------------------------


async def get_own_lists(db: AsyncSession, user_id: int) -> Sequence[WordListModel]:
    stmt = (
        select(WordListModel)
        .where(WordListModel.user_id == user_id)
        .order_by(WordListModel.position, WordListModel.id)
    )
    return (await db.execute(stmt)).scalars().all()


async def get_own_list(
    db: AsyncSession, list_id: int, user_id: int
) -> WordListModel | None:
    stmt = select(WordListModel).where(
        WordListModel.id == list_id, WordListModel.user_id == user_id
    )
    return (await db.execute(stmt)).scalars().first()


async def find_list_by_name(
    db: AsyncSession, user_id: int, name: str
) -> WordListModel | None:
    stmt = select(WordListModel).where(
        WordListModel.user_id == user_id, func.lower(WordListModel.name) == name.lower()
    )
    return (await db.execute(stmt)).scalars().first()


async def filter_own_list_ids(
    db: AsyncSession, user_id: int, list_ids: Sequence[int]
) -> set[int]:
    """Які з переданих id справді належать користувачу."""
    if not list_ids:
        return set()
    stmt = select(WordListModel.id).where(
        WordListModel.user_id == user_id, WordListModel.id.in_(set(list_ids))
    )
    return set((await db.execute(stmt)).scalars().all())


async def count_cards_by_list(db: AsyncSession, user_id: int) -> dict[int, int]:
    stmt = (
        select(CardListLinkModel.list_id, func.count())
        .join(CardModel, CardListLinkModel.card_id == CardModel.id)
        .where(CardModel.user_id == user_id)
        .group_by(CardListLinkModel.list_id)
    )
    return {list_id: count for list_id, count in (await db.execute(stmt)).all()}


async def count_due_by_list(
    db: AsyncSession, user_id: int, now: datetime
) -> dict[int, int]:
    """
    Скільки доріжок кожного списку чекає повторення.

    Фільтр береться з cruds.study._queue_conditions, а не пишеться заново:
    інакше бейдж «5» на списку розійшовся б із чергою, яка ховає доріжку FORMS
    у карток без форм і з вимкненим тренуванням.
    """
    stmt = (
        select(CardListLinkModel.list_id, func.count())
        .select_from(ReviewTrackModel)
        .join(CardModel, ReviewTrackModel.card_id == CardModel.id)
        .join(CardListLinkModel, CardListLinkModel.card_id == CardModel.id)
        .where(*_queue_conditions(user_id, None, now))
        .group_by(CardListLinkModel.list_id)
    )
    return {list_id: count for list_id, count in (await db.execute(stmt)).all()}


async def count_unlisted(
    db: AsyncSession, user_id: int, now: datetime
) -> tuple[int, int]:
    """(скільки карток без списку, скільки з них чекає повторення)."""
    no_links = ~exists().where(CardListLinkModel.card_id == CardModel.id)

    cards_stmt = select(func.count(CardModel.id)).where(
        CardModel.user_id == user_id, no_links
    )
    due_stmt = (
        select(func.count())
        .select_from(ReviewTrackModel)
        .join(CardModel, ReviewTrackModel.card_id == CardModel.id)
        .where(*_queue_conditions(user_id, None, now), no_links)
    )

    card_count = (await db.execute(cards_stmt)).scalar_one()
    due_count = (await db.execute(due_stmt)).scalar_one()
    return card_count, due_count


async def has_forms(db: AsyncSession, card_id: int) -> bool:
    stmt = select(exists().where(WordFormModel.card_id == card_id))
    return (await db.execute(stmt)).scalar_one()


# Слово вважається вивченим, коли його памʼятають щонайменше тиждень.
LEARNED_STABILITY_DAYS = 6.0


async def get_stats(db: AsyncSession, user_id: int, now: datetime) -> dict[str, int]:
    """
    Підсумок словника для екрана прогресу.

    Окремий запит, а не сума по списках: картка може лежати в кількох списках
    одночасно, тож sum(card_count) і sum(due_count) полічили б її двічі.

    due_tracks — саме доріжки, як і бейдж списку та черга. Картка з формами дає
    дві одиниці роботи, і показати «608 на повторення», коли черга віддасть 705,
    означало б занизити обсяг.

    learned рахує лише доріжку перекладу (див. CONTEXT, «Вивчено»): інакше
    вимкнення тренування форм тихо піднімало б лічильник.
    """
    lists_stmt = select(func.count(WordListModel.id)).where(
        WordListModel.user_id == user_id
    )
    cards_stmt = select(func.count(CardModel.id)).where(CardModel.user_id == user_id)
    due_stmt = (
        select(func.count())
        .select_from(ReviewTrackModel)
        .join(CardModel, ReviewTrackModel.card_id == CardModel.id)
        .where(*_queue_conditions(user_id, None, now))
    )
    learned_stmt = (
        select(func.count())
        .select_from(ReviewTrackModel)
        .join(CardModel, ReviewTrackModel.card_id == CardModel.id)
        .where(
            CardModel.user_id == user_id,
            ReviewTrackModel.kind == ReviewKindEnum.TRANSLATION,
            ReviewTrackModel.state != ReviewStateEnum.RELEARNING,
            ReviewTrackModel.stability >= LEARNED_STABILITY_DAYS,
        )
    )

    return {
        "lists": (await db.execute(lists_stmt)).scalar_one(),
        "cards": (await db.execute(cards_stmt)).scalar_one(),
        "due_tracks": (await db.execute(due_stmt)).scalar_one(),
        "learned": (await db.execute(learned_stmt)).scalar_one(),
        "stability_bands": await get_stability_bands(db, user_id),
    }


# Межі в днях. 6 збігається з LEARNED_STABILITY_DAYS навмисно: інакше на екрані
# стояли б два різні визначення «слово тримається в памʼяті».
STABILITY_BAND_EDGES = (1.0, LEARNED_STABILITY_DAYS, 30.0, 180.0)


async def get_stability_bands(db: AsyncSession, user_id: int) -> dict[str, int]:
    """
    Скільки слів у якому діапазоні стабільності — теплова смуга екрана прогресу.

    Рахуються ЛИШЕ доріжки перекладу, той самий вибір і з тієї ж причини, що в
    learned: інакше картка з формами важила б удвічі, а вимкнення тренування
    форм тихо міняло б картинку. Наслідок корисний — сума діапазонів дорівнює
    кількості карток, тож підпис «608 слів» над смугою не бреше.

    Стан NEW виділено окремо, а не покладено в «до 1 дня»: у нового слова
    stability ще NULL, і назвати це «тримається менше дня» означало б вигадати
    величину, якої немає.

    Увага: сума діапазонів від 6 днів і вище НЕ дорівнює learned. learned
    додатково виключає доріжки в стадії повторного вивчення, а смуга — ні: вона
    відповідає на «наскільки міцно», а не на «чи можна вважати вивченим».
    """
    low, learned_edge, month, half_year = STABILITY_BAND_EDGES

    band = case(
        (ReviewTrackModel.state == ReviewStateEnum.NEW, "new"),
        (ReviewTrackModel.stability < low, "under_day"),
        (ReviewTrackModel.stability < learned_edge, "days"),
        (ReviewTrackModel.stability < month, "weeks"),
        (ReviewTrackModel.stability < half_year, "months"),
        else_="long",
    )

    stmt = (
        select(band, func.count())
        .select_from(ReviewTrackModel)
        .join(CardModel, ReviewTrackModel.card_id == CardModel.id)
        .where(
            CardModel.user_id == user_id,
            ReviewTrackModel.kind == ReviewKindEnum.TRANSLATION,
        )
        .group_by(band)
    )

    counts = {name: 0 for name in ("new", "under_day", "days", "weeks", "months", "long")}
    for name, count in (await db.execute(stmt)).all():
        counts[name] = count
    return counts
