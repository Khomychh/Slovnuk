from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fsrs import Rating
from sqlalchemy.ext.asyncio import AsyncSession

from app.cruds import study as study_crud
from app.database.database import get_db
from app.database.models import ReviewLogModel, UserModel
from app.schemas.study import (
    QueueItemSchema,
    QueueResponseSchema,
    StudyDayResponseSchema,
    StudySettingsResponseSchema,
    StudySettingsUpdateSchema,
    TrackReviewRequestSchema,
    TrackReviewResponseSchema,
)
from app.security.dependencies import get_current_authenticated_user
from app.services.scheduler import review_track
from app.services.study_day import (
    is_goal_met,
    local_day,
    local_day_bounds,
    resolve_timezone,
)

router = APIRouter()


@router.get(
    "/queue/",
    response_model=QueueResponseSchema,
    summary="Today's review queue",
    description=(
        "Tracks whose time has come, reviews first and new ones after, "
        "shuffled within each group."
    ),
    status_code=status.HTTP_200_OK,
)
async def get_queue(
    limit: int = Query(50, ge=1, le=100),
    list_ids: list[int] | None = Query(
        None, description="Обмежити списками: ?list_ids=3&list_ids=7"
    ),
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> QueueResponseSchema:
    """
    Черга нічого не ріже цілями: ціль — орієнтир, а не обмеження, і застосунок
    ніколи не ховає картки, яким настав час.

    Параметра offset тут немає навмисно. Відповідь виштовхує доріжку з черги,
    тож черга коротшає під час сесії, і зсунута сторінка пропускала б картки.
    Фронтенд щоразу питає перші N — забуті слова, які повертаються через 10
    хвилин, так само самі спливуть у наступній вибірці.
    """
    now = datetime.now(timezone.utc)

    due_count, new_count = await study_crud.count_queue(
        db, current_user.id, list_ids, now
    )
    tracks = await study_crud.fetch_queue(db, current_user.id, list_ids, now, limit)

    return QueueResponseSchema(
        due_count=due_count,
        new_count=new_count,
        items=[QueueItemSchema.model_validate(track) for track in tracks],
    )


@router.post(
    "/tracks/{track_id}/review/",
    response_model=TrackReviewResponseSchema,
    summary="Review a Track",
    description="Submit a rating for one review track and get its next scheduled state back.",
    status_code=status.HTTP_200_OK,
)
async def review_track_endpoint(
    track_id: int,
    review_data: TrackReviewRequestSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> TrackReviewResponseSchema:
    """
    Оцінює одну доріжку повторення й одразу зберігає результат.

    track_id належить чужому користувачу або не існує — 404, щоб не
    підтверджувати факт існування чужого track_id.

    Разом із відповіддю фіксується знімок цілей на сьогодні. Він навмисно
    нічого не рахує: рахунок робить GET /today/. Тут важливо лише те, що цілі
    цього дня записані ЗАРАЗ, поки вони ще актуальні.
    """
    track = await study_crud.get_own_track_for_update(db, track_id, current_user.id)
    if not track:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "track_not_found", "message": "Review track not found."},
        )

    settings = await study_crud.get_user_settings(db, current_user.id)

    review_datetime = datetime.now(timezone.utc)
    state_before = review_track(
        track=track,
        settings=settings,
        rating=Rating(review_data.rating),
        review_datetime=review_datetime,
        review_duration=review_data.review_duration,
    )

    db.add(
        ReviewLogModel(
            rating=review_data.rating,
            reviewed_at=review_datetime,
            review_duration=review_data.review_duration,
            state_before=state_before,
            due_at_after=track.due_at,
            user_id=current_user.id,
            track_id=track.id,
        )
    )

    tz = resolve_timezone(settings.timezone)
    await study_crud.ensure_study_day(
        db,
        user_id=current_user.id,
        day=local_day(review_datetime, tz),
        new_goal=settings.daily_new_goal,
        review_goal=settings.daily_review_goal,
    )

    await db.commit()
    await db.refresh(track)

    return TrackReviewResponseSchema.model_validate(track)


@router.get(
    "/today/",
    response_model=StudyDayResponseSchema,
    summary="Today's study day",
    description="Goals in force today, what has been done, and whether the day is closed.",
    status_code=status.HTTP_200_OK,
)
async def get_today(
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> StudyDayResponseSchema:
    """
    Рахує виконання й закриває всі незакриті дні, а не лише сьогоднішній.

    Через це «перше відкриття наступного дня» само добиває вчорашній: рахунок
    береться з незмінних даних (review_logs, cards.created_at), тож зробити це
    пізніше так само точно, як одразу. А от цілі заднім числом не відновити —
    саме тому їхній знімок пишеться жадібно при кожній відповіді.

    Закритий день назад не переглядається: is_goal_met — зафіксований факт.
    """
    settings = await study_crud.get_user_settings(db, current_user.id)
    tz = resolve_timezone(settings.timezone)
    today = local_day(datetime.now(timezone.utc), tz)

    await study_crud.ensure_study_day(
        db,
        user_id=current_user.id,
        day=today,
        new_goal=settings.daily_new_goal,
        review_goal=settings.daily_review_goal,
    )
    today_row = await study_crud.get_study_day(db, current_user.id, today)

    start, end = local_day_bounds(today, tz)
    new_added = await study_crud.count_created_cards(db, current_user.id, start, end)
    reviews_done = await study_crud.count_reviewed_tracks(
        db, current_user.id, start, end
    )

    for row in await study_crud.get_open_study_days(db, current_user.id, today):
        if row is today_row:
            day_new, day_reviews = new_added, reviews_done
        else:
            day_start, day_end = local_day_bounds(row.day, tz)
            day_new = await study_crud.count_created_cards(
                db, current_user.id, day_start, day_end
            )
            day_reviews = await study_crud.count_reviewed_tracks(
                db, current_user.id, day_start, day_end
            )
        if is_goal_met(
            new_added=day_new,
            reviews_done=day_reviews,
            new_goal=row.new_goal,
            review_goal=row.review_goal,
        ):
            row.is_goal_met = True

    response = StudyDayResponseSchema(
        day=today,
        new_goal=today_row.new_goal,
        review_goal=today_row.review_goal,
        new_added=new_added,
        reviews_done=reviews_done,
        is_goal_met=today_row.is_goal_met,
    )
    await db.commit()
    return response


@router.get(
    "/settings/",
    response_model=StudySettingsResponseSchema,
    summary="Get study settings",
    status_code=status.HTTP_200_OK,
)
async def get_settings(
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> StudySettingsResponseSchema:
    settings = await study_crud.get_user_settings(db, current_user.id)
    return StudySettingsResponseSchema.model_validate(settings)


@router.patch(
    "/settings/",
    response_model=StudySettingsResponseSchema,
    summary="Update study settings",
    description="Partial update. Personal scheduler weights are not writable here.",
    status_code=status.HTTP_200_OK,
)
async def update_settings(
    payload: StudySettingsUpdateSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> StudySettingsResponseSchema:
    """
    Зміна цілей не переписує історію: дні, які вже мають рядок, зберігають ті
    цілі, що діяли тоді. Нові значення почнуть діяти з наступного дня — або з
    сьогоднішнього, якщо жодної дії сьогодні ще не було.
    """
    settings = await study_crud.get_user_settings(db, current_user.id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(settings, field, value)

    await db.commit()
    await db.refresh(settings)

    return StudySettingsResponseSchema.model_validate(settings)
