from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.cruds import grammar as grammar_crud
from app.database.database import get_db
from app.database.models import GrammarNoteModel, NoteCategoryModel, UserModel
from app.schemas.grammar import (
    GrammarNoteCreateSchema,
    GrammarNotePageSchema,
    GrammarNoteSchema,
    GrammarNoteUpdateSchema,
    NoteCategoryCreateSchema,
    NoteCategoryPageSchema,
    NoteCategorySchema,
    NoteCategoryUpdateSchema,
    UncategorizedSchema,
)
from app.security.dependencies import get_current_authenticated_user

router = APIRouter()


def _note_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "note_not_found", "message": "Grammar note not found."},
    )


def _category_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "category_not_found", "message": "Note category not found."},
    )


def _to_schema(note: GrammarNoteModel) -> GrammarNoteSchema:
    """
    category_name кладеться руками, бо в моделі це relationship, а не колонка.

    Звернення до note.category тут безпечне лише тому, що всі вибірки в
    cruds.grammar роблять selectinload: лінивий доступ у persistent-обʼєкта
    async-сесії падає з MissingGreenlet.
    """
    return GrammarNoteSchema(
        id=note.id,
        title=note.title,
        body_markdown=note.body_markdown,
        position=note.position,
        category_id=note.category_id,
        category_name=note.category.name if note.category else None,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


async def _resolve_category(
    db: AsyncSession, user_id: int, name: str | None
) -> int | None:
    """
    Назва розділу → id, зі створенням розділу за потреби.

    Саме тут живе рішення «розділ задається назвою»: у старому додатку це поле
    з підказкою, куди назва вписується на ходу, і вимагати окремий POST перед
    кожним новим ярликом означало б два запити там, де користувач зробив одну
    дію. Порожня назва — це «Без розділу», а не розділ на імʼя «».
    """
    if not name:
        return None

    category = await grammar_crud.find_category_by_name(db, user_id, name)
    if category is None:
        category = NoteCategoryModel(
            name=name.strip(),
            user_id=user_id,
            position=await grammar_crud.next_category_position(db, user_id),
        )
        db.add(category)
        await db.flush()

    return category.id


# --------------------------------------------------------------------------
# Розділи
# --------------------------------------------------------------------------


@router.get(
    "/categories/",
    response_model=NoteCategoryPageSchema,
    summary="Note categories with counts",
    description="All categories plus the virtual 'uncategorized' group.",
    status_code=status.HTTP_200_OK,
)
async def get_categories(
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> NoteCategoryPageSchema:
    """
    Порожні розділи лишаються у відповіді.

    Старий додаток виводив розділи скануванням нотаток, тож розділ випаровувався
    разом з останньою нотаткою. Тепер це рядок, і поводиться він як порожній
    список слів: зникає тільки явним DELETE. Ховати порожні — справа фронтенду,
    для цього і є note_count.
    """
    categories = await grammar_crud.get_own_categories(db, current_user.id)
    counts = await grammar_crud.count_notes_by_category(db, current_user.id)
    uncategorized = await grammar_crud.count_uncategorized(db, current_user.id)

    return NoteCategoryPageSchema(
        items=[
            NoteCategorySchema(
                id=row.id,
                name=row.name,
                position=row.position,
                note_count=counts.get(row.id, 0),
            )
            for row in categories
        ],
        uncategorized=UncategorizedSchema(note_count=uncategorized),
    )


@router.post(
    "/categories/",
    response_model=NoteCategorySchema,
    summary="Create a category",
    status_code=status.HTTP_201_CREATED,
)
async def create_category(
    payload: NoteCategoryCreateSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> NoteCategorySchema:
    """
    Створити розділ наперед, ще до першої нотатки, — дозволена дія: саме тому
    порожні розділи й не прибираються автоматично.

    Назва, що вже існує, повертає наявний розділ, а не 409: користувач просив
    «хай буде розділ Часи», і він є.
    """
    existing = await grammar_crud.find_category_by_name(
        db, current_user.id, payload.name
    )
    if existing:
        counts = await grammar_crud.count_notes_by_category(db, current_user.id)
        return NoteCategorySchema(
            id=existing.id,
            name=existing.name,
            position=existing.position,
            note_count=counts.get(existing.id, 0),
        )

    category = NoteCategoryModel(
        name=payload.name,
        user_id=current_user.id,
        position=await grammar_crud.next_category_position(db, current_user.id),
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)

    return NoteCategorySchema(
        id=category.id,
        name=category.name,
        position=category.position,
        note_count=0,
    )


@router.patch(
    "/categories/{category_id}/",
    response_model=NoteCategorySchema,
    summary="Rename or reorder a category",
    status_code=status.HTTP_200_OK,
)
async def update_category(
    category_id: int,
    payload: NoteCategoryUpdateSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> NoteCategorySchema:
    """
    Перейменування — один UPDATE, і саме заради нього розділ став сутністю, а не
    рядком усередині кожної нотатки.
    """
    category = await grammar_crud.get_own_category(db, category_id, current_user.id)
    if not category:
        raise _category_not_found()

    if payload.name is not None:
        clash = await grammar_crud.find_category_by_name(
            db, current_user.id, payload.name
        )
        if clash and clash.id != category.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "category_exists",
                    "message": "A category with this name already exists.",
                    "category_id": clash.id,
                    "name": clash.name,
                },
            )
        category.name = payload.name

    if payload.position is not None:
        category.position = payload.position

    await db.commit()
    await db.refresh(category)

    counts = await grammar_crud.count_notes_by_category(db, current_user.id)
    return NoteCategorySchema(
        id=category.id,
        name=category.name,
        position=category.position,
        note_count=counts.get(category.id, 0),
    )


@router.delete(
    "/categories/{category_id}/",
    summary="Delete a category",
    description="Notes are kept and move to the 'uncategorized' group.",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_category(
    category_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Видалення розділу ніколи не видаляє нотаток — вони їдуть у «Без розділу»
    через ON DELETE SET NULL. Так само поводиться видалення списку слів.

    Видаляємо Core-запитом, а не db.delete(category): ORM для цього підвантажив
    би колекцію notes, а лінивий доступ у async-сесії падає з MissingGreenlet.
    """
    category = await grammar_crud.get_own_category(db, category_id, current_user.id)
    if not category:
        raise _category_not_found()

    await db.execute(
        sql_delete(NoteCategoryModel).where(NoteCategoryModel.id == category.id)
    )
    await db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# Нотатки
# --------------------------------------------------------------------------


@router.get(
    "/notes/",
    response_model=GrammarNotePageSchema,
    summary="Browse grammar notes",
    status_code=status.HTTP_200_OK,
)
async def get_notes(
    category_id: int | None = Query(None, description="Нотатки цього розділу"),
    uncategorized: bool = Query(False, description="Тільки нотатки без розділу"),
    q: str | None = Query(None, description="Пошук по заголовку і тілу"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> GrammarNotePageSchema:
    """
    Тіло нотатки входить у список: дерево граматики одразу вміє розкрити будь-яку
    нотатку без другого запиту, а 9 нотаток по 600 символів — це 6 КБ.

    uncategorized=true перебиває category_id, а не дає порожню вибірку: обидва
    разом означають взаємно виключні речі, і мовчазна порожнеча тут гірша за
    очевидний вибір на користь явнішого прапорця.
    """
    conditions = grammar_crud.note_filters(
        current_user.id, category_id, uncategorized, q
    )

    total = await grammar_crud.count_notes(db, conditions)
    notes = await grammar_crud.fetch_notes(
        db, conditions, limit=per_page, offset=(page - 1) * per_page
    )

    return GrammarNotePageSchema(
        total=total,
        page=page,
        per_page=per_page,
        items=[_to_schema(note) for note in notes],
    )


@router.get(
    "/notes/{note_id}/",
    response_model=GrammarNoteSchema,
    summary="Get one note",
    status_code=status.HTTP_200_OK,
)
async def get_note(
    note_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> GrammarNoteSchema:
    note = await grammar_crud.get_own_note(db, note_id, current_user.id)
    if not note:
        raise _note_not_found()
    return _to_schema(note)


@router.post(
    "/notes/",
    response_model=GrammarNoteSchema,
    summary="Create a note",
    description="Body is Markdown; rendering stays on the frontend.",
    status_code=status.HTTP_201_CREATED,
)
async def create_note(
    payload: GrammarNoteCreateSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> GrammarNoteSchema:
    """
    Нотатки не перевіряються на дублікати заголовка — на відміну від карток.
    Два правила з назвою «Артиклі» це нормально; два слова «decision» — ні.
    """
    note = GrammarNoteModel(
        title=payload.title,
        body_markdown=payload.body_markdown,
        user_id=current_user.id,
        category_id=await _resolve_category(db, current_user.id, payload.category),
    )
    db.add(note)
    await db.commit()

    return _to_schema(await grammar_crud.get_own_note(db, note.id, current_user.id))


@router.patch(
    "/notes/{note_id}/",
    response_model=GrammarNoteSchema,
    summary="Update a note",
    status_code=status.HTTP_200_OK,
)
async def update_note(
    note_id: int,
    payload: GrammarNoteUpdateSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> GrammarNoteSchema:
    """
    Часткове оновлення. `category: null` прибирає розділ, відсутнє поле лишає
    його як є — розрізняє їх exclude_unset, бо за типом обидва випадки None.

    Розділ, з якого пішла остання нотатка, не видаляється: він міг бути
    створений навмисно й наперед.
    """
    note = await grammar_crud.get_own_note(db, note_id, current_user.id)
    if not note:
        raise _note_not_found()

    fields = payload.model_dump(exclude_unset=True)

    if "title" in fields and fields["title"] is not None:
        note.title = fields["title"]
    if "body_markdown" in fields:
        note.body_markdown = fields["body_markdown"]
    if "position" in fields and fields["position"] is not None:
        note.position = fields["position"]
    if "category" in fields:
        # FK пишеться напряму: присвоєння note.category тягне lazy-load старого
        # значення, а це MissingGreenlet в async-сесії.
        note.category_id = await _resolve_category(
            db, current_user.id, fields["category"]
        )

    await db.commit()

    return _to_schema(await grammar_crud.get_own_note(db, note.id, current_user.id))


@router.delete(
    "/notes/{note_id}/",
    summary="Delete a note",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_note(
    note_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Видалення нотатки нічого не тягне за собою: нотатки не беруть участі в
    повтореннях, тож і історії повторень тут немає (пор. ADR-0003).
    """
    note = await grammar_crud.get_own_note(db, note_id, current_user.id)
    if not note:
        raise _note_not_found()

    await db.delete(note)
    await db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
