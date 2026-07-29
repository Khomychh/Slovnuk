"""
Запити до бази для шерингу.

Логіки імпорту тут немає — вона в app/services/sharing.py, щоб її можна було
перевірити без бази.
"""

from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.models import (
    CardListLinkModel,
    CardModel,
    ListShareModel,
    UserModel,
    WordListModel,
    WordSenseModel,
    normalize_word,
)


# Чужа картка їде назовні вмістом: значення з прикладами і форми. Доріжки й
# мітки списків не потрібні — це прогрес і структура автора, не вміст слова.
SHARED_CARD_LOADERS = (
    selectinload(CardModel.senses).selectinload(WordSenseModel.examples),
    selectinload(CardModel.forms),
)


# --------------------------------------------------------------------------
# Посилання
# --------------------------------------------------------------------------


async def get_active_share(db: AsyncSession, list_id: int) -> ListShareModel | None:
    """Активний шер списку. Він рівно один — на цьому стоїть ідемпотентність POST."""
    stmt = select(ListShareModel).where(
        ListShareModel.list_id == list_id, ListShareModel.is_active.is_(True)
    )
    return (await db.execute(stmt)).scalars().first()


async def get_share_by_token(db: AsyncSession, token: str) -> ListShareModel | None:
    """
    Шер за токеном разом зі списком і профілем автора.

    Вимкнений шер теж повертається: роут має відрізнити «власник вимкнув
    доступ» (410) від «такого посилання не існує» (404).
    """
    stmt = (
        select(ListShareModel)
        .where(ListShareModel.token == token)
        .options(
            selectinload(ListShareModel.word_list),
            selectinload(ListShareModel.owner).selectinload(UserModel.profile),
        )
    )
    return (await db.execute(stmt)).scalars().first()


async def active_tokens_by_list(db: AsyncSession, user_id: int) -> dict[int, str]:
    """
    Токени всіх поділених списків користувача — щоб акордеон словника малював
    іконку «поділено» без запиту на кожен список.
    """
    stmt = select(ListShareModel.list_id, ListShareModel.token).where(
        ListShareModel.owner_id == user_id, ListShareModel.is_active.is_(True)
    )
    return {list_id: token for list_id, token in (await db.execute(stmt)).all()}


# --------------------------------------------------------------------------
# Вміст поділеного списку
# --------------------------------------------------------------------------


def _list_cards(list_id: int):
    return (
        select(CardModel)
        .join(CardListLinkModel, CardListLinkModel.card_id == CardModel.id)
        .where(CardListLinkModel.list_id == list_id)
    )


async def count_list_cards(db: AsyncSession, list_id: int) -> int:
    stmt = select(func.count()).select_from(
        _list_cards(list_id).subquery()
    )
    return (await db.execute(stmt)).scalar_one()


async def fetch_list_cards(
    db: AsyncSession, list_id: int, limit: int | None = None, offset: int = 0
) -> Sequence[CardModel]:
    """
    Картки списку разом із вмістом.

    Порядок той самий, що й у словнику, — новіші зверху: перегляд чужого списку
    має виглядати так само, як власний.
    """
    stmt = (
        _list_cards(list_id)
        .options(*SHARED_CARD_LOADERS)
        .order_by(CardModel.created_at.desc(), CardModel.id.desc())
    )
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    return (await db.execute(stmt)).scalars().all()


async def count_already_have(db: AsyncSession, user_id: int, list_id: int) -> int:
    """
    Скільки слів поділеного списку в отримувача вже є.

    Звірка за нормалізованим словом — тим самим ключем, яким база тримає
    унікальність картки. Якщо посилання відкрив сам автор, це число дорівнює
    всьому списку, і так і має бути.
    """
    mine = select(CardModel.word_normalized).where(CardModel.user_id == user_id)
    stmt = select(func.count()).select_from(
        _list_cards(list_id)
        .where(CardModel.word_normalized.in_(mine))
        .subquery()
    )
    return (await db.execute(stmt)).scalar_one()


async def own_cards_by_word(
    db: AsyncSession, user_id: int, words: Sequence[str]
) -> dict[str, CardModel]:
    """
    Власні картки за нормалізованим словом.

    Підвантажується все, чого торкнеться overwrite, і кожна колекція тут
    обов'язкова: вміст очищає copy_content, мітку списку дописує роут, а
    review_tracks читає ensure_tracks, коли з чужої картки приїхали форми.
    Звернення до незавантаженої relationship в async-сесії падає з
    MissingGreenlet — тобто імпорт валиться на 500 посеред запису.
    """
    keys = {normalize_word(word) for word in words}
    if not keys:
        return {}

    stmt = (
        select(CardModel)
        .where(CardModel.user_id == user_id, CardModel.word_normalized.in_(keys))
        .options(
            *SHARED_CARD_LOADERS,
            selectinload(CardModel.list_links),
            selectinload(CardModel.review_tracks),
        )
    )
    return {
        card.word_normalized: card
        for card in (await db.execute(stmt)).scalars().all()
    }


async def taken_list_names(db: AsyncSession, user_id: int) -> set[str]:
    stmt = select(WordListModel.name).where(WordListModel.user_id == user_id)
    return set((await db.execute(stmt)).scalars().all())
