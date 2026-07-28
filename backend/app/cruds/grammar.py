"""
Запити до бази для граматики.

Довідник простіший за словник: жодних доріжок, жодного планувальника. Уся
незвичність тут в одному — розділ заводиться сам, коли його назву вперше
вписали в нотатку.
"""

from typing import Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.models import GrammarNoteModel, NoteCategoryModel


# --------------------------------------------------------------------------
# Нотатки
# --------------------------------------------------------------------------


def note_filters(
    user_id: int,
    category_id: int | None,
    uncategorized: bool,
    q: str | None,
) -> list:
    """
    Спільний фільтр для вибірки і для лічильника, щоб `total` не розходився з
    тим, що реально прийде.

    Пошук іде і по заголовку, і по тілу — на відміну від старого додатка, який
    шукав лише в заголовку, хоч і показував уривок із тіла. Довідник, у якому
    не знайти правило за словом із тексту, погано виконує роль довідника.
    """
    conditions = [GrammarNoteModel.user_id == user_id]

    if uncategorized:
        conditions.append(GrammarNoteModel.category_id.is_(None))
    elif category_id is not None:
        conditions.append(GrammarNoteModel.category_id == category_id)

    if q:
        pattern = f"%{q.strip()}%"
        conditions.append(
            func.coalesce(GrammarNoteModel.title, "").ilike(pattern)
            | func.coalesce(GrammarNoteModel.body_markdown, "").ilike(pattern)
        )

    return conditions


def _ordered(stmt: Select) -> Select:
    """
    Порядок: розділ, потім position, потім id.

    id як остання ланка обовʼязковий: position за замовчуванням 0 у всіх, а
    Postgres при рівних ключах не обіцяє сталого порядку — без нього список
    смикався б між запитами.
    """
    return stmt.order_by(
        GrammarNoteModel.category_id.nulls_last(),
        GrammarNoteModel.position,
        GrammarNoteModel.id,
    )


async def count_notes(db: AsyncSession, conditions: Sequence) -> int:
    stmt = select(func.count(GrammarNoteModel.id)).where(*conditions)
    return (await db.execute(stmt)).scalar_one()


async def fetch_notes(
    db: AsyncSession, conditions: Sequence, limit: int, offset: int
) -> Sequence[GrammarNoteModel]:
    stmt = (
        _ordered(select(GrammarNoteModel).where(*conditions))
        .options(selectinload(GrammarNoteModel.category))
        .limit(limit)
        .offset(offset)
    )
    return (await db.execute(stmt)).scalars().all()


async def get_own_note(
    db: AsyncSession, note_id: int, user_id: int
) -> GrammarNoteModel | None:
    """
    populate_existing обовʼязковий, і ось чому.

    Сесія налаштована з expire_on_commit=False, тож після коміту обʼєкт лишається
    в identity map із уже завантаженим `category`. Звичайний повторний SELECT
    поверне саме його і НЕ перезапише завантажену relationship — роут віддав би
    `category_id: null` разом зі старим `category_name`, тобто відповідь, що
    суперечить сама собі. Те саме при переносі нотатки з розділу в розділ.
    """
    stmt = (
        select(GrammarNoteModel)
        .where(GrammarNoteModel.id == note_id, GrammarNoteModel.user_id == user_id)
        .options(selectinload(GrammarNoteModel.category))
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalars().first()


# --------------------------------------------------------------------------
# Розділи
# --------------------------------------------------------------------------


async def get_own_categories(
    db: AsyncSession, user_id: int
) -> Sequence[NoteCategoryModel]:
    stmt = (
        select(NoteCategoryModel)
        .where(NoteCategoryModel.user_id == user_id)
        .order_by(NoteCategoryModel.position, NoteCategoryModel.id)
    )
    return (await db.execute(stmt)).scalars().all()


async def get_own_category(
    db: AsyncSession, category_id: int, user_id: int
) -> NoteCategoryModel | None:
    stmt = select(NoteCategoryModel).where(
        NoteCategoryModel.id == category_id, NoteCategoryModel.user_id == user_id
    )
    return (await db.execute(stmt)).scalars().first()


async def find_category_by_name(
    db: AsyncSession, user_id: int, name: str
) -> NoteCategoryModel | None:
    """
    Пошук без урахування регістру: UNIQUE(user_id, name) регістр розрізняє, тож
    без цього «Часи» і «часи» стали б двома розділами — рівно та фантомна
    категорія, від якої сутність і рятує.
    """
    stmt = select(NoteCategoryModel).where(
        NoteCategoryModel.user_id == user_id,
        func.lower(NoteCategoryModel.name) == name.strip().lower(),
    )
    return (await db.execute(stmt)).scalars().first()


async def next_category_position(db: AsyncSession, user_id: int) -> int:
    """Новий розділ стає в кінець, а не поперед уже впорядкованих."""
    stmt = select(func.coalesce(func.max(NoteCategoryModel.position), -1) + 1).where(
        NoteCategoryModel.user_id == user_id
    )
    return (await db.execute(stmt)).scalar_one()


async def count_notes_by_category(db: AsyncSession, user_id: int) -> dict[int, int]:
    stmt = (
        select(GrammarNoteModel.category_id, func.count(GrammarNoteModel.id))
        .where(
            GrammarNoteModel.user_id == user_id,
            GrammarNoteModel.category_id.is_not(None),
        )
        .group_by(GrammarNoteModel.category_id)
    )
    return {row_id: count for row_id, count in (await db.execute(stmt)).all()}


async def count_uncategorized(db: AsyncSession, user_id: int) -> int:
    stmt = select(func.count(GrammarNoteModel.id)).where(
        GrammarNoteModel.user_id == user_id,
        GrammarNoteModel.category_id.is_(None),
    )
    return (await db.execute(stmt)).scalar_one()
