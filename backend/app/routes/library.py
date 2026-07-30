"""
Роути Бібліотеки.

Два адресні простори, як і в шерингу, і з тієї ж причини:
`/vocabulary/lists/{id}/publication/` — дії власника над своїм списком,
`/library/…` — те, що бачить і робить читач.

Три правила, які тут вирішуються і яких немає в шерингу.

**Опублікувати можна лише з іменем і прізвищем.** Безіменний список у Бібліотеці
не накопичує ні репутації, ні довіри. Це єдина брама на вхід, і вона нічого не
перевіряє — вписати «Джон Сміт» ніхто не заборонить; її робота в тому, щоб
змусити подумати перед публікацією й дати витрині людський підпис.

**Знята модератором не воскресає рукою автора.** `is_listed=false` сам по собі не
каже, чи можна публікувати знову, — різницю тримає `hidden_by_id`.

**Взяття не має режиму перезапису.** У шері він доречний, бо ти знаєш, від кого
береш; тут на іншому кінці незнайомець, а ціна помилки — роки власних перекладів.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.cruds import library as library_crud
from app.cruds import sharing as sharing_crud
from app.cruds import study as study_crud
from app.cruds import vocabulary as vocabulary_crud
from app.database.database import get_db
from app.database.models import (
    PublicationModel,
    PublicationRatingModel,
    PublicationReportModel,
    PublicationTakeModel,
    UserModel,
    WordListModel,
)
from app.schemas.library import (
    LibraryPageSchema,
    PublicationDetailSchema,
    PublicationOwnerSchema,
    PublicationSummarySchema,
    PublicationTakeResultSchema,
    PublicationTakeSchema,
    PublicationWriteSchema,
    RatingSchema,
    RatingWriteSchema,
    ReportWriteSchema,
    SnapshotCardPageSchema,
    SnapshotCardSchema,
)
from app.schemas.sharing import SharedFormSchema, SharedSenseSchema
from app.security.dependencies import (
    get_current_authenticated_user,
    get_current_user_with_profile,
)
from app.services.library import card_from_snapshot, plan_take, snapshot_rows
from app.services.sharing import suggest_name
from app.services.study_day import local_day, resolve_timezone
from app.services.vocabulary import apply_list_links, ensure_tracks

router = APIRouter()


# --------------------------------------------------------------------------
# Спільне
# --------------------------------------------------------------------------


def _list_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "list_not_found", "message": "Word list not found."},
    )


def _publication_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "publication_not_found", "message": "Publication not found."},
    )


def _author_label(publication: PublicationModel) -> str | None:
    """
    Підпис автора — ім'я та прізвище з профілю.

    None означає, що автор видалив акаунт (ADR-0020), а не що профіль порожній:
    без імені й прізвища опублікувати не можна взагалі. Пошта не віддається
    ніколи: витрину бачить кожен користувач застосунку.
    """
    if publication.owner is None:
        return None

    profile = publication.owner.profile
    if profile is None:
        return None

    parts = [part for part in (profile.first_name, profile.last_name) if part]
    return " ".join(parts) or None


def _summary(
    row: Row, sample_words: list[str] | None = None
) -> PublicationSummarySchema:
    """
    Рядок витрини з рядка запиту.

    Лічильники приходять агрегатами (`cruds/library`), а не колонками моделі, —
    саме тому тут ручне складання, а не `model_validate`.

    `sample_words` віддається окремим пакетним запитом на всю сторінку, тож сюди
    приходить готовим списком. Порожній він законно: у публікації з видаленим
    знімком слів немає.
    """
    publication: PublicationModel = row[0]
    return PublicationSummarySchema(
        id=publication.id,
        title=publication.title,
        description=publication.description,
        author=_author_label(publication),
        sample_words=sample_words or [],
        cards_count=row.cards_count,
        takes_count=row.takes_count,
        rating=float(row.rating) if row.rating is not None else None,
        ratings_count=row.ratings_count,
        content_updated_at=publication.content_updated_at,
        derived_from_title=(
            publication.derived_from.title if publication.derived_from else None
        ),
        is_taken=row.is_taken,
    )


async def _visible_publication(db: AsyncSession, publication_id: int, user_id: int) -> Row:
    """
    Публікація, яку читачеві можна показати.

    Знята — 410, а не 404: вона існувала, і читач має бачити різницю між «автор
    закрив» і «ти помилився посиланням». Так само зроблено з вимкненим шером.
    """
    row = await library_crud.get_publication_summary(db, publication_id, user_id)
    if row is None:
        raise _publication_not_found()

    if not row[0].is_listed:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={
                "code": "publication_unlisted",
                "message": "This publication is no longer in the library.",
            },
        )
    return row


def _snapshot_card(row, already_have: bool) -> SnapshotCardSchema:
    content = row.content or {}
    return SnapshotCardSchema(
        word=row.word,
        comment=row.comment,
        senses=[
            SharedSenseSchema.model_validate(sense)
            for sense in content.get("senses", [])
        ],
        forms=[
            SharedFormSchema.model_validate(form) for form in content.get("forms", [])
        ],
        already_have=already_have,
    )


# --------------------------------------------------------------------------
# Власник
# --------------------------------------------------------------------------


async def _owner_view(
    db: AsyncSession, publication: PublicationModel
) -> PublicationOwnerSchema:
    rating, ratings_count = await library_crud.rating_aggregate(db, publication.id)
    takes = await library_crud.get_publication_summary(
        db, publication.id, publication.owner_id or 0
    )

    return PublicationOwnerSchema(
        id=publication.id,
        title=publication.title,
        description=publication.description,
        is_listed=publication.is_listed,
        hidden_by_moderator=publication.hidden_by_id is not None,
        can_update=publication.list_id is not None,
        cards_count=await library_crud.count_snapshot(db, publication.id),
        list_cards_count=(
            await library_crud.count_list_cards(db, publication.list_id)
            if publication.list_id is not None
            else None
        ),
        takes_count=takes.takes_count if takes is not None else 0,
        rating=rating,
        ratings_count=ratings_count,
        content_updated_at=publication.content_updated_at,
        created_at=publication.created_at,
    )


async def _write_snapshot(
    db: AsyncSession, publication_id: int, list_id: int
) -> None:
    """
    Зняти знімок зі списку.

    Картки беруться з `sharing_crud.fetch_list_cards` — тим самим запитом, яким
    їх віддає шер, тобто з уже завантаженими значеннями, прикладами й формами.
    Без цього `snapshot_content` упреться в MissingGreenlet уже після того, як
    рядок публікації вставлено.
    """
    cards = await sharing_crud.fetch_list_cards(db, list_id)
    await library_crud.replace_snapshot(db, publication_id, snapshot_rows(cards))


@router.post(
    "/vocabulary/lists/{list_id}/publication/",
    response_model=PublicationOwnerSchema,
    summary="Publish a word list to the library",
    description="Idempotent: returns the existing publication if the list has one.",
    status_code=status.HTTP_200_OK,
)
async def publish_list(
    list_id: int,
    payload: PublicationWriteSchema,
    # get_current_user_with_profile, а НЕ get_current_authenticated_user: та
    # вантажить лише group, і `current_user.profile` тут був би лінивим
    # завантаженням в async-сесії, тобто MissingGreenlet і 500 на успішному
    # шляху. Це єдиний роут Бібліотеки, якому профіль потрібен, — решта підпис
    # автора бере із selectinload у крудах.
    current_user: UserModel = Depends(get_current_user_with_profile),
    db: AsyncSession = Depends(get_db),
) -> PublicationOwnerSchema:
    """
    Виставити список у Бібліотеці — або оновити назву й опис наявної публікації.

    Ідемпотентно, як `share_list`: у списку публікація щонайбільше одна, тож
    повторний POST не плодить другої. Але знімок тут НЕ перезнімається — для
    цього є окрема дія. Інакше правка опису тихо міняла б вміст, за який люди
    поставили зірки.

    Знята модератором не вертається цим викликом: `is_listed` лишається false,
    поки `hidden_by_id` не порожній.
    """
    word_list = await vocabulary_crud.get_own_list(db, list_id, current_user.id)
    if not word_list:
        raise _list_not_found()

    profile = current_user.profile
    if not profile or not (profile.first_name or "").strip() or not (
        profile.last_name or ""
    ).strip():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "author_name_required",
                "message": "Fill in your first and last name before publishing.",
            },
        )

    now = datetime.now(timezone.utc)
    publication = await library_crud.get_list_publication(db, list_id)

    if publication is None:
        publication = PublicationModel(
            title=payload.title,
            description=payload.description,
            list_id=list_id,
            owner_id=current_user.id,
            content_updated_at=now,
            # Провенанс переписується зі списку в момент публікації, а не
            # читається щоразу: сам список можуть видалити, і тоді позначка
            # «росте з ‹оригінал›» загубилась би.
            derived_from_id=word_list.imported_from_publication_id,
        )
        db.add(publication)
        await db.flush()
        await _write_snapshot(db, publication.id, list_id)
    else:
        publication.title = payload.title
        publication.description = payload.description
        if publication.hidden_by_id is None:
            publication.is_listed = True

    await db.commit()
    await db.refresh(publication)
    return await _owner_view(db, publication)


@router.post(
    "/vocabulary/lists/{list_id}/publication/refresh/",
    response_model=PublicationOwnerSchema,
    summary="Refresh the published snapshot",
    description="Replaces the snapshot with the list as it is now. Ratings are kept.",
    status_code=status.HTTP_200_OK,
)
async def refresh_publication(
    list_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> PublicationOwnerSchema:
    """
    Перезняти знімок зі списку.

    Рейтинг і взяття лишаються — інакше автор, який виправив одну друкарську
    помилку, втрачав би 4.6★ і більше ніколи цю кнопку не натискав (ADR-0020).
    Витрина показує дату оновлення, тож розбіжність між старими зірками й новим
    вмістом видима.
    """
    word_list = await vocabulary_crud.get_own_list(db, list_id, current_user.id)
    if not word_list:
        raise _list_not_found()

    publication = await library_crud.get_list_publication(db, list_id)
    if publication is None:
        raise _publication_not_found()

    await _write_snapshot(db, publication.id, list_id)
    publication.content_updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(publication)
    return await _owner_view(db, publication)


@router.get(
    "/vocabulary/lists/{list_id}/publication/",
    response_model=PublicationOwnerSchema,
    summary="The publication of this list",
    status_code=status.HTTP_200_OK,
)
async def get_list_publication(
    list_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> PublicationOwnerSchema:
    """Знята публікація тут віддається як є — власник має бачити її стан."""
    word_list = await vocabulary_crud.get_own_list(db, list_id, current_user.id)
    if not word_list:
        raise _list_not_found()

    publication = await library_crud.get_list_publication(db, list_id)
    if publication is None:
        raise _publication_not_found()

    return await _owner_view(db, publication)


@router.delete(
    "/vocabulary/lists/{list_id}/publication/",
    summary="Take the publication off the library",
    description="The row and its ratings stay; publishing again restores them.",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unpublish_list(
    list_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Зняти з витрини — прапорцем, не видаленням.

    Тут правило шеру ІНВЕРТУЄТЬСЯ: вимкнене посилання не воскресає, а публікація
    воскресає тим самим рядком разом із рейтингом. Причина в тому, що токен
    адресує доступ (і мусить гаснути назавжди), а публікація — репутацію
    (ADR-0020).
    """
    word_list = await vocabulary_crud.get_own_list(db, list_id, current_user.id)
    if not word_list:
        raise _list_not_found()

    publication = await library_crud.get_list_publication(db, list_id)
    if publication is None:
        raise _publication_not_found()

    publication.is_listed = False
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# Витрина
# --------------------------------------------------------------------------


@router.get(
    "/library/",
    response_model=LibraryPageSchema,
    summary="Browse the library",
    status_code=status.HTTP_200_OK,
)
async def browse_library(
    q: str | None = Query(None, description="Пошук по назві й опису"),
    sort: Literal["popular", "fresh", "rating"] = Query(
        "popular",
        description=(
            "popular — за кількістю взять, fresh — за датою оновлення знімка, "
            "rating — за видимим рейтингом, неоцінені в хвіст"
        ),
    ),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> LibraryPageSchema:
    """
    Витрина. Свої публікації з неї не ховаються: автор має бачити свій список
    там, де його бачать інші.

    `per_page` за замовчуванням 20, а не 50 як у словнику: рядок витрини несе
    опис і три числа, тобто значно вищий за рядок словника.
    """
    conditions = library_crud.library_filters(q)

    total = await library_crud.count_publications(db, conditions)
    rows = await library_crud.fetch_publications(
        db,
        conditions,
        current_user.id,
        limit=per_page,
        offset=(page - 1) * per_page,
        sort=sort,
    )

    sample = await library_crud.sample_words_by_publication(
        db, [row[0].id for row in rows]
    )

    return LibraryPageSchema(
        total=total,
        page=page,
        per_page=per_page,
        items=[_summary(row, sample.get(row[0].id)) for row in rows],
    )


@router.get(
    "/library/publications/{publication_id}/",
    response_model=PublicationDetailSchema,
    summary="Get one publication",
    status_code=status.HTTP_200_OK,
)
async def get_publication(
    publication_id: int,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> PublicationDetailSchema:
    """
    Сторінка публікації.

    `new_cards` важливіше за `cards_count`: саме воно описує наслідок кнопки. У
    списку з 540 слів, 45 із яких у тебе вже є, додасться 495 — і це видно ще до
    натискання.
    """
    row = await _visible_publication(db, publication_id, current_user.id)
    sample = await library_crud.sample_words_by_publication(db, [publication_id])
    summary = _summary(row, sample.get(publication_id))

    take = await library_crud.get_take(db, publication_id, current_user.id)
    rating = await library_crud.get_rating(db, publication_id, current_user.id)
    report = await library_crud.get_report(db, publication_id, current_user.id)
    taken = await sharing_crud.taken_list_names(db, current_user.id)

    return PublicationDetailSchema(
        **summary.model_dump(),
        new_cards=await library_crud.count_new_cards(
            db, current_user.id, publication_id
        ),
        suggested_name=suggest_name(row[0].title, taken),
        can_rate=take is not None,
        own_stars=rating.stars if rating else None,
        own_report=report.reason if report else None,
    )


@router.get(
    "/library/publications/{publication_id}/cards/",
    response_model=SnapshotCardPageSchema,
    summary="Browse a publication's words",
    status_code=status.HTTP_200_OK,
)
async def get_publication_cards(
    publication_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> SnapshotCardPageSchema:
    """
    Сторінками, а не цілком: у живому словнику є список на 540 слів.

    `already_have` рахується лише для слів цієї сторінки — одним запитом по
    нормалізованих словах, а не звіркою всього словника.
    """
    await _visible_publication(db, publication_id, current_user.id)

    total = await library_crud.count_snapshot(db, publication_id)
    rows = await library_crud.fetch_snapshot(
        db, publication_id, limit=per_page, offset=(page - 1) * per_page
    )
    mine = await library_crud.own_words(
        db, current_user.id, [row.word for row in rows]
    )

    return SnapshotCardPageSchema(
        total=total,
        page=page,
        per_page=per_page,
        items=[
            _snapshot_card(row, row.word_normalized in mine) for row in rows
        ],
    )


# --------------------------------------------------------------------------
# Дії читача
# --------------------------------------------------------------------------


@router.post(
    "/library/publications/{publication_id}/take/",
    response_model=PublicationTakeResultSchema,
    summary="Take a publication into your vocabulary",
    description="Copies the words you do not have yet, under a name you choose.",
    status_code=status.HTTP_201_CREATED,
)
async def take_publication(
    publication_id: int,
    payload: PublicationTakeSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> PublicationTakeResultSchema:
    """
    Взяти список із Бібліотеки.

    Наявні слова пропускаються й НАЗИВАЮТЬСЯ у звіті: список неповний за
    визначенням (ADR-0005), і неповнота, про яку не сказали, читається як
    загублені слова. Режиму перезапису тут немає взагалі.

    Взяття записується навіть тоді, коли жодного слова не додалось: людина
    справді брала цю публікацію, і на цьому стоїть її право поставити зірки.
    Свою власну публікацію взяти не можна — не через заборону, а тому, що це
    завжди дало б порожній результат.

    Взяті картки рахуються в денну ціль «додати слова» як звичайні — вони справді
    з'явились у словнику того дня. Тому тут, як і при створенні картки, пишеться
    знімок цілей: інакше день існував би в лічильниках і не існував у календарі.
    """
    row = await _visible_publication(db, publication_id, current_user.id)
    publication: PublicationModel = row[0]

    if publication.owner_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "own_publication",
                "message": "This is your own publication.",
                "list_id": publication.list_id,
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

    snapshot = await library_crud.fetch_snapshot(db, publication_id)
    existing = await sharing_crud.own_cards_by_word(
        db, current_user.id, [item.word for item in snapshot]
    )
    plan = plan_take(snapshot, existing)

    now = datetime.now(timezone.utc)

    # Взяття пишеться незалежно від того, чи щось додалось. UNIQUE(publication_id,
    # user_id) тримає «одне на людину», тож повторне взяття під іншою назвою
    # популярності не накрутить — і `taken_at` лишається часом ПЕРШОГО взяття.
    if await library_crud.get_take(db, publication_id, current_user.id) is None:
        db.add(
            PublicationTakeModel(
                publication_id=publication_id, user_id=current_user.id
            )
        )

    if plan.is_empty:
        # Списку не створюємо: порожня іменована мітка в словнику — сміття, яке
        # користувач мусив би прибирати руками.
        await db.commit()
        return PublicationTakeResultSchema(
            list_id=None,
            name=payload.name,
            created=0,
            skipped=plan.skipped,
            skipped_words=list(plan.skipped_words),
        )

    word_list = WordListModel(
        name=payload.name,
        user_id=current_user.id,
        imported_from_user_id=publication.owner_id,
        imported_from_publication_id=publication_id,
        imported_at=now,
    )
    db.add(word_list)
    await db.flush()

    for source in plan.sources:
        card = card_from_snapshot(source, current_user.id)
        apply_list_links(card, [word_list.id])
        ensure_tracks(card, now)
        db.add(card)

    settings = await study_crud.get_user_settings(db, current_user.id)
    await study_crud.ensure_study_day(
        db,
        user_id=current_user.id,
        day=local_day(now, resolve_timezone(settings.timezone)),
        new_goal=settings.daily_new_goal,
        review_goal=settings.daily_review_goal,
    )

    await db.commit()

    return PublicationTakeResultSchema(
        list_id=word_list.id,
        name=word_list.name,
        created=len(plan.sources),
        skipped=plan.skipped,
        skipped_words=list(plan.skipped_words),
    )


@router.put(
    "/library/publications/{publication_id}/rating/",
    response_model=RatingSchema,
    summary="Rate a publication",
    description="Only someone who has taken the publication can rate it.",
    status_code=status.HTTP_200_OK,
)
async def rate_publication(
    publication_id: int,
    payload: RatingWriteSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> RatingSchema:
    """
    PUT, а не POST: одна людина — одна оцінка, і повторний виклик її замінює.

    Право на оцінку — це наявність взяття, і воно переживає видалення взятого
    списку: ти справді брав, і право сказати про це не зникає з прибиранням у
    себе. Саме тому перевіряється `publication_takes`, а не наявність списку.
    """
    await _visible_publication(db, publication_id, current_user.id)

    if await library_crud.get_take(db, publication_id, current_user.id) is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "take_required",
                "message": "Take the list first — a rating means you used it.",
            },
        )

    rating = await library_crud.get_rating(db, publication_id, current_user.id)
    if rating is None:
        db.add(
            PublicationRatingModel(
                publication_id=publication_id,
                user_id=current_user.id,
                stars=payload.stars,
            )
        )
    else:
        rating.stars = payload.stars

    await db.commit()

    visible, count = await library_crud.rating_aggregate(db, publication_id)
    return RatingSchema(rating=visible, ratings_count=count, own_stars=payload.stars)


@router.post(
    "/library/publications/{publication_id}/report/",
    summary="Report a publication",
    description="One report per person. Repeating it changes the reason.",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def report_publication(
    publication_id: int,
    payload: ReportWriteSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Скарга: причина з закритого набору й нічого більше.

    Взяття тут НЕ потрібне — на обсценний список скаржаться саме тому, що не
    хочуть його брати. Друга скарга тієї самої людини змінює причину, а не
    додає ваги: скарги важать людьми.

    204, а не 200 з тілом: показувати лічильник скарг публічно означало б дати
    спосіб цькувати автора числом.
    """
    await _visible_publication(db, publication_id, current_user.id)

    report = await library_crud.get_report(db, publication_id, current_user.id)
    if report is None:
        db.add(
            PublicationReportModel(
                publication_id=publication_id,
                user_id=current_user.id,
                reason=payload.reason,
            )
        )
    else:
        report.reason = payload.reason

    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
