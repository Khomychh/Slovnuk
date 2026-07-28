"""
Запити до бази для словника.

Тут вибірка карток і списків та лічильники. Логіки збереження картки тут немає —
вона в app/services/vocabulary.py, щоб її можна було перевірити без бази.
"""

from datetime import datetime
from typing import Sequence

from sqlalchemy import Select, and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.cruds.study import _queue_conditions
from app.database.models import (
    CardListLinkModel,
    CardModel,
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
            )
        )

    return conditions


async def count_cards(db: AsyncSession, conditions: Sequence) -> int:
    stmt = select(func.count(CardModel.id)).where(*conditions)
    return (await db.execute(stmt)).scalar_one()


async def fetch_cards(
    db: AsyncSession, conditions: Sequence, limit: int, offset: int
) -> Sequence[CardModel]:
    """
    Сторінка словника, новіші зверху — як у старому PWA.

    Зсувна пагінація тут безпечна, на відміну від черги: рядки словника під час
    перегляду нікуди не діваються, тож сторінки не з'їжджають.
    """
    stmt: Select = (
        select(CardModel)
        .where(*conditions)
        .options(*CARD_LOADERS)
        .order_by(CardModel.created_at.desc(), CardModel.id.desc())
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
