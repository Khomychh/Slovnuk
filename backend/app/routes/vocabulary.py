from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.cruds import library as library_crud
from app.cruds import sharing as sharing_crud
from app.cruds import study as study_crud
from app.cruds import vocabulary as vocabulary_crud
from app.database.database import get_db
from app.database.models import CardModel, UserModel, WordListModel
from app.schemas.vocabulary import (
    CardCreateSchema,
    CardPageSchema,
    CardSchema,
    CardUpdateSchema,
    UnlistedSchema,
    VocabularyStatsSchema,
    WordListCreateSchema,
    WordListPageSchema,
    WordListSchema,
    WordListUpdateSchema,
)
from app.security.dependencies import get_current_authenticated_user
from app.services.study_day import local_day, resolve_timezone
from app.services.vocabulary import (
    UnknownChildIdError,
    apply_forms,
    apply_list_links,
    apply_senses,
    ensure_tracks,
)

router = APIRouter()


def _card_not_found() -> HTTPException:
    """
    404 і для чужої картки теж — щоб відповідь не підтверджувала, що такий
    card_id взагалі існує.
    """
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "card_not_found", "message": "Card not found."},
    )


def _unknown_child_ids(error: UnknownChildIdError) -> HTTPException:
    """
    Невідомий id дитини — 422, а не тихе створення нового рядка.

    Мовчазне створення приховало б помилку клієнта, а мовчазне оновлення дало б
    спосіб правити чужі значення.
    """
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail={
            "code": "unknown_child_id",
            "message": "Some sense, example or form ids do not belong to this card.",
            "ids": error.unknown_ids,
        },
    )


def _list_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "list_not_found", "message": "Word list not found."},
    )


async def _resolve_list_ids(
    db: AsyncSession, user_id: int, list_ids: list[int]
) -> list[int]:
    """
    Лишити тільки свої списки, чужий чи неіснуючий id — 422.

    Тихо ігнорувати не можна: користувач побачив би «збережено», а картка не
    з'явилась би там, куди він її клав.
    """
    if not list_ids:
        return []

    own = await vocabulary_crud.filter_own_list_ids(db, user_id, list_ids)
    unknown = sorted(set(list_ids) - own)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "unknown_list_ids",
                "message": "Some list ids do not belong to you.",
                "list_ids": unknown,
            },
        )
    return list(dict.fromkeys(list_ids))


# --------------------------------------------------------------------------
# Списки
# --------------------------------------------------------------------------


@router.get(
    "/lists/",
    response_model=WordListPageSchema,
    summary="Word lists with counts",
    description="All lists plus the virtual 'unlisted' group, with card and due counts.",
    status_code=status.HTTP_200_OK,
)
async def get_lists(
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> WordListPageSchema:
    """
    Списки віддаються без пагінації: їх одиниці, і акордеон словника показує
    всі одразу.

    Блок unlisted — не список, а «Без списку»: картки, що не лежать у жодному
    списку. Без нього видалення списку ховало б його картки назавжди, хоч ті
    далі приходили б на повторення.
    """
    now = datetime.now(timezone.utc)

    lists = await vocabulary_crud.get_own_lists(db, current_user.id)
    cards_by_list = await vocabulary_crud.count_cards_by_list(db, current_user.id)
    due_by_list = await vocabulary_crud.count_due_by_list(db, current_user.id, now)
    share_tokens = await sharing_crud.active_tokens_by_list(db, current_user.id)
    in_library = await library_crud.listed_list_ids(db, current_user.id)
    unlisted_cards, unlisted_due = await vocabulary_crud.count_unlisted(
        db, current_user.id, now
    )

    return WordListPageSchema(
        items=[
            WordListSchema(
                id=row.id,
                name=row.name,
                position=row.position,
                card_count=cards_by_list.get(row.id, 0),
                due_count=due_by_list.get(row.id, 0),
                share_token=share_tokens.get(row.id),
                in_library=row.id in in_library,
            )
            for row in lists
        ],
        unlisted=UnlistedSchema(card_count=unlisted_cards, due_count=unlisted_due),
    )


@router.post(
    "/lists/",
    response_model=WordListSchema,
    summary="Create a word list",
    status_code=status.HTTP_201_CREATED,
)
async def create_list(
    payload: WordListCreateSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> WordListSchema:
    existing = await vocabulary_crud.find_list_by_name(
        db, current_user.id, payload.name
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "list_exists",
                "message": "A list with this name already exists.",
                "list_id": existing.id,
                "name": existing.name,
            },
        )

    word_list = WordListModel(name=payload.name, user_id=current_user.id)
    db.add(word_list)
    await db.commit()
    await db.refresh(word_list)

    return WordListSchema(
        id=word_list.id,
        name=word_list.name,
        position=word_list.position,
        card_count=0,
        due_count=0,
    )


@router.patch(
    "/lists/{list_id}/",
    response_model=WordListSchema,
    summary="Rename or reorder a word list",
    status_code=status.HTTP_200_OK,
)
async def update_list(
    list_id: int,
    payload: WordListUpdateSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> WordListSchema:
    word_list = await vocabulary_crud.get_own_list(db, list_id, current_user.id)
    if not word_list:
        raise _list_not_found()

    fields = payload.model_dump(exclude_unset=True)

    if "name" in fields and fields["name"] is not None:
        clash = await vocabulary_crud.find_list_by_name(
            db, current_user.id, fields["name"]
        )
        if clash and clash.id != word_list.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "list_exists",
                    "message": "A list with this name already exists.",
                    "list_id": clash.id,
                    "name": clash.name,
                },
            )

    for field, value in fields.items():
        if value is not None:
            setattr(word_list, field, value)

    await db.commit()
    await db.refresh(word_list)

    now = datetime.now(timezone.utc)
    cards_by_list = await vocabulary_crud.count_cards_by_list(db, current_user.id)
    due_by_list = await vocabulary_crud.count_due_by_list(db, current_user.id, now)
    share = await sharing_crud.get_active_share(db, word_list.id)
    publication = await library_crud.get_list_publication(db, word_list.id)

    return WordListSchema(
        id=word_list.id,
        name=word_list.name,
        position=word_list.position,
        card_count=cards_by_list.get(word_list.id, 0),
        due_count=due_by_list.get(word_list.id, 0),
        share_token=share.token if share else None,
        in_library=bool(publication and publication.is_listed),
    )


@router.delete(
    "/lists/{list_id}/",
    summary="Delete a word list",
    description="The list is removed; its cards survive and fall into the unlisted group.",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_list(
    list_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Видаляється лише мітка, слова лишаються.

    Це свідома розбіжність зі старим PWA, де deleteList() стирав усі слова
    списку разом із ним. Наслідок для інтерфейсу: діалог підтвердження має
    писати правду — «список буде видалено, 40 слів залишаться в “Без списку”».
    """
    word_list = await vocabulary_crud.get_own_list(db, list_id, current_user.id)
    if not word_list:
        raise _list_not_found()

    await db.delete(word_list)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# Картки
# --------------------------------------------------------------------------


@router.get(
    "/stats/",
    response_model=VocabularyStatsSchema,
    summary="Vocabulary totals",
    description="Counts for the progress screen: lists, cards, due tracks and learned words.",
    status_code=status.HTTP_200_OK,
)
async def get_stats(
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> VocabularyStatsSchema:
    """
    Окремий ендпоінт, бо скласти ці числа з /lists/ не можна: картка може лежати
    в кількох списках, і сума по списках полічила б її двічі.
    """
    stats = await vocabulary_crud.get_stats(
        db, current_user.id, datetime.now(timezone.utc)
    )
    return VocabularyStatsSchema(**stats)


@router.get(
    "/cards/",
    response_model=CardPageSchema,
    summary="Browse the vocabulary",
    status_code=status.HTTP_200_OK,
)
async def get_cards(
    list_id: int | None = Query(None, description="Картки цього списку"),
    unlisted: bool = Query(False, description="Тільки картки без жодного списку"),
    q: str | None = Query(
        None, description="Пошук по слову, перекладу, уточненню і формах"
    ),
    word: str | None = Query(None, description="Точний збіг — перевірка дубліката"),
    sort: Literal["created", "word", "stability"] = Query(
        "created",
        description=(
            "created — новіші зверху, word — за абеткою, "
            "stability — спершу холодні, нові попереду"
        ),
    ),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> CardPageSchema:
    """
    Порядок — новіші зверху, як у старому PWA.

    Фільтри складаються через AND: ?list_id=4&q=talk означає «talk у списку 4».
    Комбінація list_id з unlisted=true дає порожню вибірку за визначенням і
    помилкою не є.
    """
    conditions = vocabulary_crud.card_filters(
        current_user.id, list_id, unlisted, q, word
    )

    total = await vocabulary_crud.count_cards(db, conditions)
    cards = await vocabulary_crud.fetch_cards(
        db, conditions, limit=per_page, offset=(page - 1) * per_page, sort=sort
    )

    return CardPageSchema(
        total=total,
        page=page,
        per_page=per_page,
        items=[CardSchema.model_validate(card) for card in cards],
    )


@router.get(
    "/cards/{card_id}/",
    response_model=CardSchema,
    summary="Get one card",
    status_code=status.HTTP_200_OK,
)
async def get_card(
    card_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> CardSchema:
    card = await vocabulary_crud.get_own_card(db, card_id, current_user.id)
    if not card:
        raise _card_not_found()
    return CardSchema.model_validate(card)


@router.post(
    "/cards/",
    response_model=CardSchema,
    summary="Create a card",
    description="The whole card at once: word, senses with examples, forms and list labels.",
    status_code=status.HTTP_201_CREATED,
)
async def create_card(
    payload: CardCreateSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> CardSchema:
    """
    Слово унікальне в межах користувача незалежно від списків.

    Дублікат — 409 з id наявної картки, а не тихе злиття: користувач щойно
    набрав нові переклади, і мовчки їх викинути гірше, ніж запитати. З id
    фронтенд одразу пропонує «“decision” вже у вашому словнику — відкрити?».
    """
    duplicate = await vocabulary_crud.find_card_by_word(
        db, current_user.id, payload.word
    )
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "card_exists",
                "message": "This word is already in your vocabulary.",
                "card_id": duplicate.id,
                "word": duplicate.word,
            },
        )

    list_ids = await _resolve_list_ids(db, current_user.id, payload.list_ids)

    card = CardModel(
        word=payload.word,
        comment=payload.comment,
        forms_drill_enabled=payload.forms_drill_enabled,
        user_id=current_user.id,
    )
    # У новій картки дітей ще немає, тож будь-який переданий id — чужий.
    try:
        apply_senses(card, payload.senses)
        apply_forms(card, payload.forms)
    except UnknownChildIdError as error:
        raise _unknown_child_ids(error)
    now = datetime.now(timezone.utc)
    apply_list_links(card, list_ids)
    ensure_tracks(card, now)

    db.add(card)

    # Знімок цілей пишеться і тут, не лише при оцінці. Інакше день, у який
    # користувач тільки додавав слова, лишався б без рядка study_days — і в
    # календарі його б не існувало, хоч робота була. А при daily_review_goal=0
    # такий день ще й може бути виконаним без жодного повторення.
    settings = await study_crud.get_user_settings(db, current_user.id)
    await study_crud.ensure_study_day(
        db,
        user_id=current_user.id,
        day=local_day(now, resolve_timezone(settings.timezone)),
        new_goal=settings.daily_new_goal,
        review_goal=settings.daily_review_goal,
    )

    await db.commit()

    return CardSchema.model_validate(await vocabulary_crud.load_card(db, card.id))


@router.patch(
    "/cards/{card_id}/",
    response_model=CardSchema,
    summary="Update a card",
    description="Partial update. Children present in the body are matched by id.",
    status_code=status.HTTP_200_OK,
)
async def update_card(
    card_id: int,
    payload: CardUpdateSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> CardSchema:
    """
    Часткове оновлення: чого немає в тілі, того не чіпаємо.

    Значення і форми звіряються за id — з id оновлюються, без id створюються,
    відсутні в тілі видаляються. Тому `senses: []` очищає значення, а відсутнє
    `senses` лишає їх як є.

    Перейменування слова прогрес НЕ скидає: доріжки живуть на картці, а не на
    тексті. Виправлена одруківка не має коштувати місяця повторень.
    """
    card = await vocabulary_crud.get_own_card(db, card_id, current_user.id)
    if not card:
        raise _card_not_found()

    fields = payload.model_dump(exclude_unset=True)

    if "word" in fields and fields["word"] is not None:
        duplicate = await vocabulary_crud.find_card_by_word(
            db, current_user.id, fields["word"]
        )
        if duplicate and duplicate.id != card.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "card_exists",
                    "message": "This word is already in your vocabulary.",
                    "card_id": duplicate.id,
                    "word": duplicate.word,
                },
            )
        card.word = fields["word"]

    if "comment" in fields:
        card.comment = fields["comment"]
    if "forms_drill_enabled" in fields and fields["forms_drill_enabled"] is not None:
        card.forms_drill_enabled = fields["forms_drill_enabled"]

    try:
        if payload.senses is not None:
            apply_senses(card, payload.senses)
        if payload.forms is not None:
            apply_forms(card, payload.forms)
    except UnknownChildIdError as error:
        raise _unknown_child_ids(error)

    if payload.list_ids is not None:
        apply_list_links(
            card, await _resolve_list_ids(db, current_user.id, payload.list_ids)
        )

    ensure_tracks(card, datetime.now(timezone.utc))

    await db.commit()

    return CardSchema.model_validate(await vocabulary_crud.load_card(db, card.id))


@router.delete(
    "/cards/{card_id}/",
    summary="Delete a card",
    description="Removes the card together with its review tracks and their logs.",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_card(
    card_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Видалення незворотне: разом із карткою каскадом зникають її доріжки і всі
    записи повторень. Це свідоме рішення, а не недогляд — див. ADR-0003.
    """
    card = await vocabulary_crud.get_own_card(db, card_id, current_user.id)
    if not card:
        raise _card_not_found()

    await db.delete(card)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
