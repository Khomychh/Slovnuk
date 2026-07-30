"""
Запити Бібліотеки.

Логіки знімка тут немає — вона в app/services/library.py, щоб її можна було
перевірити без бази.

Два рішення, які варто побачити.

**Лічильники — корельовані підзапити, а не JOIN.** Приєднавши takes, ratings і
cards одночасно, ми отримали б добуток: публікація з 540 словами, 128 взяттями і
31 оцінкою дала б 540×128×31 рядків, а `COUNT` по них — числа, які нічого не
означають. Підзапит на кожен лічильник читається як окреме питання й не множить
нічого.

**Поріг видимості рейтингу живе в SQL.** Витрина сортує за рейтингом у базі, з
LIMIT/OFFSET — тож поріг, застосований після вибірки, не працював би зовсім: «4.9
з однієї оцінки» все одно стало б першим. Тому `_VISIBLE_RATING` є одним виразом,
і він же йде і в SELECT, і в ORDER BY. Число порогу лишається одне —
RATING_VISIBILITY_THRESHOLD у моделях.
"""

from typing import Sequence

from sqlalchemy import Row, Select, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.models import (
    CardListLinkModel,
    CardModel,
    PublicationCardModel,
    PublicationModel,
    PublicationRatingModel,
    PublicationReportModel,
    PublicationTakeModel,
    RATING_VISIBILITY_THRESHOLD,
    UserModel,
    normalize_word,
)


# Автор і провенанс їдуть у кожному рядку витрини, тож вантажаться разом із ним.
# selectinload, а не joinedload: обидва — many-to-one до різних таблиць, і
# joinedload на них дав би два LEFT JOIN у запит, який і без них має чотири
# підзапити.
SUMMARY_LOADERS = (
    selectinload(PublicationModel.owner).selectinload(UserModel.profile),
    selectinload(PublicationModel.derived_from),
)


# --------------------------------------------------------------------------
# Агрегати витрини
# --------------------------------------------------------------------------

_CARDS_COUNT = (
    select(func.count())
    .select_from(PublicationCardModel)
    .where(PublicationCardModel.publication_id == PublicationModel.id)
    .scalar_subquery()
)

_TAKES_COUNT = (
    select(func.count())
    .select_from(PublicationTakeModel)
    .where(PublicationTakeModel.publication_id == PublicationModel.id)
    .scalar_subquery()
)

_RATINGS_COUNT = (
    select(func.count())
    .select_from(PublicationRatingModel)
    .where(PublicationRatingModel.publication_id == PublicationModel.id)
    .scalar_subquery()
)

_RATINGS_AVG = (
    select(func.avg(PublicationRatingModel.stars))
    .select_from(PublicationRatingModel)
    .where(PublicationRatingModel.publication_id == PublicationModel.id)
    .scalar_subquery()
)

#: Рейтинг, який можна показати: NULL, доки оцінок менше за поріг.
#:
#: NULL стоїть і при нулі оцінок, і при одній-двох — з погляду витрини це те саме
#: «поки без оцінок». Округлення до десятої тут же, у базі: різниця між 4.63 і
#: 4.64 не існує для людини, а два знаки створюють враження точності, якої в
#: тридцяти оцінках немає.
#:
#: Цей самий вираз іде в ORDER BY. Обчислити його двічі — різними способами для
#: показу й для сортування — означало б витрину, де число не збігається з місцем.
_VISIBLE_RATING = case(
    (
        _RATINGS_COUNT >= RATING_VISIBILITY_THRESHOLD,
        func.round(_RATINGS_AVG, 1),
    ),
    else_=None,
)


def _is_taken_by(user_id: int):
    """Чи є в цього глядача взяття. Витрина малює цим «взято ✓»."""
    return (
        select(func.count())
        .select_from(PublicationTakeModel)
        .where(
            PublicationTakeModel.publication_id == PublicationModel.id,
            PublicationTakeModel.user_id == user_id,
        )
        .scalar_subquery()
        > 0
    )


def publication_order(sort: str):
    """
    Порядок витрини.

    `popular` — за охопленням. Це лічильник за весь час, без вікна: вікно
    «за 30 днів» доступне (в `publication_takes` є `taken_at`), але доки
    публікацій десятки, воно лише додало б порожню категорію.

    `rating` — за видимим рейтингом, тобто NULLS LAST: непорахований рейтинг
    означає «поки без оцінок», і ставити такі списки поперед оцінених було б
    брехнею про них. Другим ключем іде охоплення — інакше в хвості стояла б купа
    неоцінених у порядку, який задає база.

    `fresh` — за часом останнього оновлення ЗНІМКА, не за `created_at`: людину
    цікавить, що змінилось у Бібліотеці, а не коли автор уперше натиснув кнопку.

    Другий ключ `id` є завжди: без нього рядки з однаковим значенням першого
    ключа можуть мінятись місцями між сторінками, і при зсувній пагінації
    публікація або продублюється, або зникне.
    """
    if sort == "rating":
        return (
            _VISIBLE_RATING.desc().nulls_last(),
            _TAKES_COUNT.desc(),
            PublicationModel.id.desc(),
        )
    if sort == "fresh":
        return (
            PublicationModel.content_updated_at.desc(),
            PublicationModel.id.desc(),
        )
    return (_TAKES_COUNT.desc(), PublicationModel.id.desc())


def library_filters(q: str | None) -> list:
    """
    Що видно у Бібліотеці.

    `is_listed` — єдина умова видимості. Знята публікація не показується нікому,
    включно з автором: у нього для неї є екран власного списку.

    Пошук іде по назві й опису, без урахування регістру. По словах усередині
    знімка не шукаємо: `publication_cards.word_normalized` для цього
    проіндексований лише в парі з publication_id, і такий пошук був би повним
    проходом. Двері не зачинені — просто зараз їх нема куди відчиняти.
    """
    conditions = [PublicationModel.is_listed.is_(True)]

    if q:
        needle = f"%{q.strip()}%"
        conditions.append(
            or_(
                PublicationModel.title.ilike(needle),
                PublicationModel.description.ilike(needle),
            )
        )

    return conditions


def _summary_select(user_id: int) -> Select:
    return select(
        PublicationModel,
        _CARDS_COUNT.label("cards_count"),
        _TAKES_COUNT.label("takes_count"),
        _VISIBLE_RATING.label("rating"),
        _RATINGS_COUNT.label("ratings_count"),
        _is_taken_by(user_id).label("is_taken"),
    ).options(*SUMMARY_LOADERS)


async def count_publications(db: AsyncSession, conditions: Sequence) -> int:
    stmt = (
        select(func.count())
        .select_from(PublicationModel)
        .where(*conditions)
    )
    return (await db.execute(stmt)).scalar_one()


async def fetch_publications(
    db: AsyncSession,
    conditions: Sequence,
    user_id: int,
    limit: int,
    offset: int,
    sort: str = "popular",
) -> Sequence[Row]:
    """
    Сторінка витрини.

    Повертає рядки, а не моделі: лічильники — це агрегати запиту, і навішувати
    їх на ORM-об'єкт означало б робити вигляд, що вони колонки. Доступ у роуті
    за іменами — `row.PublicationModel`, `row.takes_count` і далі.
    """
    stmt = (
        _summary_select(user_id)
        .where(*conditions)
        .order_by(*publication_order(sort))
        .limit(limit)
        .offset(offset)
    )
    return (await db.execute(stmt)).all()


async def get_publication_summary(
    db: AsyncSession, publication_id: int, user_id: int
) -> Row | None:
    """
    Одна публікація з тими самими агрегатами, що на витрині.

    Умови видимості тут НЕ застосовуються: роут мусить відрізнити «немає такої»
    (404) від «автор зняв» (410), а для цього рядок треба спершу знайти.
    """
    stmt = _summary_select(user_id).where(PublicationModel.id == publication_id)
    return (await db.execute(stmt)).first()


#: Скільки слів показувати в рядку витрини. Чотири — стільки, скільки вміщається
#: в один рядок на телефоні 375px і достатньо, щоб зрозуміти рівень і тему.
SAMPLE_WORDS = 4


async def sample_words_by_publication(
    db: AsyncSession, publication_ids: Sequence[int]
) -> dict[int, list[str]]:
    """
    Перші кілька слів кожної публікації — те, що читач бачить у рядку витрини.

    Одним запитом на всю сторінку, а не по публікації: інакше витрина на 20
    рядків смикала б базу 20 разів.

    Порядок — `position`, тобто той самий, у якому слова лежать у знімку. Не
    випадкові й не «найкращі»: випадкові змінювались би при кожному оновленні
    сторінки, а «найкращих» серед слів не буває.

    `position < SAMPLE_WORDS` замість LIMIT на публікацію: так це один плоский
    запит по індексу (publication_id, position), без LATERAL і без вікна.
    """
    if not publication_ids:
        return {}

    stmt = (
        select(PublicationCardModel.publication_id, PublicationCardModel.word)
        .where(
            PublicationCardModel.publication_id.in_(publication_ids),
            PublicationCardModel.position < SAMPLE_WORDS,
        )
        .order_by(PublicationCardModel.publication_id, PublicationCardModel.position)
    )

    sample: dict[int, list[str]] = {}
    for publication_id, word in (await db.execute(stmt)).all():
        sample.setdefault(publication_id, []).append(word)
    return sample


async def rating_aggregate(
    db: AsyncSession, publication_id: int
) -> tuple[float | None, int]:
    """
    Видимий рейтинг і чесна кількість оцінок — тим самим виразом, що на витрині.

    Потрібне після того, як людина поставила зірки: екран мусить одразу побачити
    новий стан, а порахувати його в Python означало б завести друге місце, де
    живе поріг.
    """
    stmt = select(
        _VISIBLE_RATING.label("rating"), _RATINGS_COUNT.label("ratings_count")
    ).where(PublicationModel.id == publication_id)
    row = (await db.execute(stmt)).first()

    if row is None:
        return None, 0
    return (float(row.rating) if row.rating is not None else None, row.ratings_count)


# --------------------------------------------------------------------------
# Публікація очима власника
# --------------------------------------------------------------------------


async def get_list_publication(
    db: AsyncSession, list_id: int
) -> PublicationModel | None:
    """
    Публікація цього списку. Вона щонайбільше одна — на цьому стоїть
    ідемпотентність POST і те, що зняття з поверненням не плодить другої.
    """
    stmt = select(PublicationModel).where(PublicationModel.list_id == list_id)
    return (await db.execute(stmt)).scalars().first()


async def get_own_publication(
    db: AsyncSession, publication_id: int, user_id: int
) -> PublicationModel | None:
    stmt = select(PublicationModel).where(
        PublicationModel.id == publication_id,
        PublicationModel.owner_id == user_id,
    )
    return (await db.execute(stmt)).scalars().first()


async def get_publication(
    db: AsyncSession, publication_id: int
) -> PublicationModel | None:
    stmt = select(PublicationModel).where(PublicationModel.id == publication_id)
    return (await db.execute(stmt)).scalars().first()


async def replace_snapshot(
    db: AsyncSession, publication_id: int, rows: Sequence[PublicationCardModel]
) -> None:
    """
    Замінити знімок цілком.

    Саме замінити, а не злити: знімок — це стан списку на момент, і «розумне»
    злиття двох станів дало б вміст, якого в жодного з них не було.

    Видалення робиться Core-запитом, а не через колекцію `publication.cards`:
    та вимагала б завантажити всі 540 рядків у пам'ять, щоб їх викинути.
    """
    await db.execute(
        delete(PublicationCardModel).where(
            PublicationCardModel.publication_id == publication_id
        )
    )
    for row in rows:
        row.publication_id = publication_id
        db.add(row)


async def count_list_cards(db: AsyncSession, list_id: int) -> int:
    """
    Скільки слів у списку ЗАРАЗ — проти того, що в знімку.

    Різниця цих двох чисел — єдиний сигнал застарілості, який ми даємо автору, і
    він неповний навмисно: виправлений в одному слові переклад кількості не
    змінює. Порівнювати вміст цілком означало б тягти весь знімок на кожне
    відкриття екрана списку.
    """
    stmt = (
        select(func.count())
        .select_from(CardListLinkModel)
        .where(CardListLinkModel.list_id == list_id)
    )
    return (await db.execute(stmt)).scalar_one()


# --------------------------------------------------------------------------
# Знімок
# --------------------------------------------------------------------------


async def count_snapshot(db: AsyncSession, publication_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(PublicationCardModel)
        .where(PublicationCardModel.publication_id == publication_id)
    )
    return (await db.execute(stmt)).scalar_one()


async def fetch_snapshot(
    db: AsyncSession, publication_id: int, limit: int | None = None, offset: int = 0
) -> Sequence[PublicationCardModel]:
    """
    Знімок у порядку, зафіксованому при зняттi.

    Без `limit` віддає все — так беруть список. Зі `limit` це сторінка перегляду:
    у живому словнику є список на 540 слів, і віддавати його одним тілом на кожне
    відкриття публікації немає причин.
    """
    stmt = (
        select(PublicationCardModel)
        .where(PublicationCardModel.publication_id == publication_id)
        .order_by(PublicationCardModel.position, PublicationCardModel.id)
    )
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    return (await db.execute(stmt)).scalars().all()


async def own_words(
    db: AsyncSession, user_id: int, words: Sequence[str]
) -> set[str]:
    """
    Які з цих слів у людини вже є — лише нормалізовані рядки, без карток.

    Легша сестра `sharing_crud.own_cards_by_word`: та вантажить значення, форми,
    мітки й доріжки, бо шер умiє перезаписувати картку. У Бібліотеці режиму
    перезапису немає, тож і тягти нічого, крім факту наявності, не треба.
    """
    keys = {normalize_word(word) for word in words}
    if not keys:
        return set()

    stmt = select(CardModel.word_normalized).where(
        CardModel.user_id == user_id, CardModel.word_normalized.in_(keys)
    )
    return set((await db.execute(stmt)).scalars().all())


async def count_new_cards(db: AsyncSession, user_id: int, publication_id: int) -> int:
    """
    Скільки слів справді додасться.

    Саме це число, а не розмір знімка, чесно описує наслідок кнопки: у публікації
    з 540 слів, 45 із яких у тебе вже є, додасться 495. Якщо публікацію відкрив
    сам автор, воно дорівнює нулю, і так і має бути.
    """
    mine = select(CardModel.word_normalized).where(CardModel.user_id == user_id)
    stmt = (
        select(func.count())
        .select_from(PublicationCardModel)
        .where(
            PublicationCardModel.publication_id == publication_id,
            PublicationCardModel.word_normalized.notin_(mine),
        )
    )
    return (await db.execute(stmt)).scalar_one()


# --------------------------------------------------------------------------
# Взяття, зірки, скарга
# --------------------------------------------------------------------------


async def get_take(
    db: AsyncSession, publication_id: int, user_id: int
) -> PublicationTakeModel | None:
    """
    Взяття цієї людини. Воно ж — право поставити зірки, і переживає видалення
    взятого списку: ти справді брав.
    """
    stmt = select(PublicationTakeModel).where(
        PublicationTakeModel.publication_id == publication_id,
        PublicationTakeModel.user_id == user_id,
    )
    return (await db.execute(stmt)).scalars().first()


async def get_rating(
    db: AsyncSession, publication_id: int, user_id: int
) -> PublicationRatingModel | None:
    stmt = select(PublicationRatingModel).where(
        PublicationRatingModel.publication_id == publication_id,
        PublicationRatingModel.user_id == user_id,
    )
    return (await db.execute(stmt)).scalars().first()


async def get_report(
    db: AsyncSession, publication_id: int, user_id: int
) -> PublicationReportModel | None:
    stmt = select(PublicationReportModel).where(
        PublicationReportModel.publication_id == publication_id,
        PublicationReportModel.user_id == user_id,
    )
    return (await db.execute(stmt)).scalars().first()


async def listed_list_ids(db: AsyncSession, user_id: int) -> set[int]:
    """
    Списки цього користувача, які зараз на витрині Бібліотеки.

    Пакетно, а не запитом на кожен список, — рівно як `active_tokens_by_list` у
    шерингу: інакше екран «Списки» смикав би базу вісім разів, щоб намалювати
    вісім позначок.

    Зняті публікації сюди НЕ входять: у рядку списку показується стан «на
    витрині», а не «колись публікував».
    """
    stmt = select(PublicationModel.list_id).where(
        PublicationModel.owner_id == user_id,
        PublicationModel.is_listed.is_(True),
        PublicationModel.list_id.isnot(None),
    )
    return {row for row in (await db.execute(stmt)).scalars().all() if row is not None}


# Назви зайнятих списків і підказку вільної Бібліотека бере з шерингу
# (`sharing_crud.taken_list_names`, `services.sharing.suggest_name`) — це правило
# називання списків, спільне для обох шляхів, а не власність шеру. Другий
# екземпляр розійшовся б із першим у першому ж 409.
