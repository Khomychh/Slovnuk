"""
Роути шерингу.

Тут два різних адресних простори, і це навмисно: /vocabulary/lists/{id}/share/
— це дії власника над своїм списком, /shares/{token}/ — те, що бачить і робить
отримувач. Обоє вимагають логіну: незареєстрованому користувачу в застосунку
нічого робити, а токен, який відкривається без акаунта, довелося б захищати від
перебору окремо.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.cruds import sharing as sharing_crud
from app.cruds import study as study_crud
from app.cruds import vocabulary as vocabulary_crud
from app.database.database import get_db
from app.database.models import (
    CardListLinkModel,
    ListShareModel,
    UserModel,
    WordListModel,
)
from app.schemas.sharing import (
    ImportMode,
    ShareImportResultSchema,
    ShareImportSchema,
    SharePreviewSchema,
    ShareSchema,
    SharedCardPageSchema,
    SharedCardSchema,
    SharedFormSchema,
    SharedSenseSchema,
)
from app.security.dependencies import get_current_authenticated_user
from app.services.sharing import copy_content, new_card, plan_import, suggest_name
from app.services.study_day import local_day, resolve_timezone
from app.services.vocabulary import apply_list_links, ensure_tracks

router = APIRouter()


def _list_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "list_not_found", "message": "Word list not found."},
    )


def _share_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "share_not_found", "message": "Share link not found."},
    )


async def _resolve_share(db: AsyncSession, token: str) -> ListShareModel:
    """
    Живий шер за токеном.

    Вимкнене посилання — 410, а не 404: воно існувало, і отримувач має бачити
    різницю між «власник закрив доступ» і «ти помилився посиланням».
    """
    share = await sharing_crud.get_share_by_token(db, token)
    if share is None:
        raise _share_not_found()
    if not share.is_active:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={
                "code": "share_disabled",
                "message": "The owner has turned this link off.",
            },
        )
    return share


def _owner_name(share: ListShareModel) -> str | None:
    """
    Підпис автора — тільки ім'я з профілю.

    Email не віддаємо ніколи: посилання ходить у листуванні, і адреса поїхала б
    разом із ним. Порожнє ім'я лишається порожнім — вигадувати підпис із логіна
    означало б прив'язати публічну назву до пошти назавжди.
    """
    profile = share.owner.profile
    return profile.first_name if profile else None


# --------------------------------------------------------------------------
# Власник
# --------------------------------------------------------------------------


@router.post(
    "/vocabulary/lists/{list_id}/share/",
    response_model=ShareSchema,
    summary="Share a word list",
    description="Returns the existing link if the list is already shared.",
    status_code=status.HTTP_200_OK,
)
async def share_list(
    list_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> ShareSchema:
    """
    Ідемпотентно: у списку рівно одне активне посилання.

    Інакше кожне натискання «Поділитись» плодило б новий токен, а відрізнити їх
    між собою не було б чим — адресності в шері немає.
    """
    word_list = await vocabulary_crud.get_own_list(db, list_id, current_user.id)
    if not word_list:
        raise _list_not_found()

    share = await sharing_crud.get_active_share(db, list_id)
    if share is None:
        share = ListShareModel(list_id=list_id, owner_id=current_user.id)
        db.add(share)
        await db.commit()
        await db.refresh(share)

    return ShareSchema.model_validate(share)


@router.delete(
    "/vocabulary/lists/{list_id}/share/",
    summary="Turn the share link off",
    description="The link stops working; already imported copies are untouched.",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unshare_list(
    list_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Рядок не видаляється, а гасне.

    Мертвий рядок дешевший за втрачений сенс: із ним старе посилання відповідає
    «власник вимкнув доступ», а не «немає такого». Увімкнути знову — це новий
    токен, тож вимкнене посилання вже не воскресне.
    """
    word_list = await vocabulary_crud.get_own_list(db, list_id, current_user.id)
    if not word_list:
        raise _list_not_found()

    share = await sharing_crud.get_active_share(db, list_id)
    if share is None:
        raise _share_not_found()

    share.is_active = False
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# Отримувач
# --------------------------------------------------------------------------


@router.get(
    "/shares/{token}/",
    response_model=SharePreviewSchema,
    summary="Preview a shared list",
    status_code=status.HTTP_200_OK,
)
async def preview_share(
    token: str,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> SharePreviewSchema:
    """
    Зведення до імпорту.

    `new_cards` важливіше за `total_cards`: саме воно описує наслідок кнопки.
    Список із 50 слів, 12 із яких у тебе вже є, додасть 38 карток — а якщо
    сходиться все, то жодної, і це видно ще до натискання.
    """
    share = await _resolve_share(db, token)

    total = await sharing_crud.count_list_cards(db, share.list_id)
    already = await sharing_crud.count_already_have(db, current_user.id, share.list_id)
    taken = await sharing_crud.taken_list_names(db, current_user.id)

    return SharePreviewSchema(
        list_name=share.word_list.name,
        owner_name=_owner_name(share),
        total_cards=total,
        new_cards=total - already,
        suggested_name=suggest_name(share.word_list.name, taken),
    )


@router.get(
    "/shares/{token}/cards/",
    response_model=SharedCardPageSchema,
    summary="Browse a shared list",
    status_code=status.HTTP_200_OK,
)
async def preview_share_cards(
    token: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> SharedCardPageSchema:
    """
    Сторінками, а не цілком: у живому словнику є список на 540 слів, і віддавати
    його одним тілом на кожне відкриття посилання немає причин.

    `already_have` рахується лише для слів цієї сторінки — один запит по
    нормалізованих словах, а не звірка всього словника.
    """
    share = await _resolve_share(db, token)

    total = await sharing_crud.count_list_cards(db, share.list_id)
    cards = await sharing_crud.fetch_list_cards(
        db, share.list_id, limit=per_page, offset=(page - 1) * per_page
    )
    mine = await sharing_crud.own_cards_by_word(
        db, current_user.id, [card.word for card in cards]
    )

    return SharedCardPageSchema(
        total=total,
        page=page,
        per_page=per_page,
        items=[
            SharedCardSchema(
                word=card.word,
                comment=card.comment,
                senses=[SharedSenseSchema.model_validate(sense) for sense in card.senses],
                forms=[SharedFormSchema.model_validate(form) for form in card.forms],
                already_have=card.word_normalized in mine,
            )
            for card in cards
        ],
    )


@router.post(
    "/shares/{token}/import/",
    response_model=ShareImportResultSchema,
    summary="Import a shared list",
    description="Copies the list into your own vocabulary under a name you choose.",
    status_code=status.HTTP_201_CREATED,
)
async def import_share(
    token: str,
    payload: ShareImportSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> ShareImportResultSchema:
    """
    Імпорт — копія, а не підписка: подальші зміни в оригіналі сюди не доходять.

    Режим `skip` не чіпає наявних карток узагалі — вони не потрапляють і в новий
    список, тож той виходить неповним (ADR-0005). Режим `overwrite` заміняє
    вміст власної картки вмістом із шеру і додає її в список; прогрес при цьому
    не скидається — доріжки живуть на картці, а не на її тексті.

    Імпортовані картки рахуються в денну ціль «додати слова» як звичайні: вони
    справді з'явились у словнику того дня. Тому тут, як і при створенні картки,
    пишеться знімок цілей — інакше день існував би в лічильниках і не існував
    у календарі.
    """
    share = await _resolve_share(db, token)

    if share.owner_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "own_share",
                "message": "This is your own list.",
                "list_id": share.list_id,
            },
        )

    clash = await vocabulary_crud.find_list_by_name(db, current_user.id, payload.name)
    if clash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "list_exists",
                "message": "A list with this name already exists.",
                "list_id": clash.id,
                "name": clash.name,
            },
        )

    shared_cards = await sharing_crud.fetch_list_cards(db, share.list_id)
    existing = await sharing_crud.own_cards_by_word(
        db, current_user.id, [card.word for card in shared_cards]
    )
    plan = plan_import(shared_cards, existing, payload.mode)

    if plan.is_empty:
        # Списку не створюємо: порожня іменована мітка в словнику — сміття,
        # яке користувач мусив би прибирати руками.
        return ShareImportResultSchema(
            list_id=None,
            name=payload.name,
            created=0,
            overwritten=0,
            skipped=plan.skipped,
        )

    now = datetime.now(timezone.utc)

    word_list = WordListModel(
        name=payload.name,
        user_id=current_user.id,
        imported_from_user_id=share.owner_id,
        imported_at=now,
    )
    db.add(word_list)
    await db.flush()

    for source in plan.sources:
        card = new_card(source, current_user.id)
        apply_list_links(card, [word_list.id])
        ensure_tracks(card, now)
        db.add(card)

    for source, target in plan.overwrites:
        copy_content(source, target)
        # Саме append, а не apply_list_links: у режимі overwrite картка додається
        # до нового списку, а не переїжджає з усіх своїх попередніх.
        target.list_links.append(CardListLinkModel(list_id=word_list.id))
        ensure_tracks(target, now)

    settings = await study_crud.get_user_settings(db, current_user.id)
    await study_crud.ensure_study_day(
        db,
        user_id=current_user.id,
        day=local_day(now, resolve_timezone(settings.timezone)),
        new_goal=settings.daily_new_goal,
        review_goal=settings.daily_review_goal,
    )

    await db.commit()

    return ShareImportResultSchema(
        list_id=word_list.id,
        name=word_list.name,
        created=len(plan.sources),
        overwritten=len(plan.overwrites),
        skipped=plan.skipped,
    )
