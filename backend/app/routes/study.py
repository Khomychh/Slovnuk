from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fsrs import Rating, Scheduler
from sqlalchemy.ext.asyncio import AsyncSession

from app.cruds import study as study_crud
from app.cruds import vocabulary as vocabulary_crud
from app.database.database import get_db
from app.database.models import ReviewLogModel, UserModel
from app.schemas.study import (
    QueueCardSchema,
    QueueItemSchema,
    QueueResponseSchema,
    RatingPreviewSchema,
    StudyDayResponseSchema,
    StudyDaySchema,
    StudyDaysResponseSchema,
    StudySettingsResponseSchema,
    StudySettingsUpdateSchema,
    TrackReviewRequestSchema,
    TrackReviewResponseSchema,
)
from app.security.dependencies import get_current_authenticated_user
from app.services.scheduler import build_scheduler, preview_intervals, review_track
from app.services.study_day import (
    is_goal_met,
    local_day,
    local_day_bounds,
    resolve_timezone,
)

router = APIRouter()


def _rating_preview(
    track, scheduler: Scheduler, now: datetime
) -> RatingPreviewSchema:
    """Прогноз інтервалів на чотири оцінки — підпис під кнопками після відповіді."""
    seconds = preview_intervals(track, scheduler, now)
    return RatingPreviewSchema(
        again=seconds[Rating.Again],
        hard=seconds[Rating.Hard],
        good=seconds[Rating.Good],
        easy=seconds[Rating.Easy],
    )


async def _day_counts(
    db: AsyncSession,
    user_id: int,
    tz: ZoneInfo,
    first_day: date,
    last_day: date,
) -> dict[date, tuple[int, int]]:
    """
    Скільки додано і скільки повторено кожної доби діапазону, двома запитами.

    Межі беруться з тих самих local_day_bounds, що й у /today/: від опівночі
    першого дня до опівночі наступного після останнього. Групування за добою
    робить уже Postgres — інакше на «весь час» вийшло б два запити на кожен
    день історії.
    """
    start, _ = local_day_bounds(first_day, tz)
    _, end = local_day_bounds(last_day, tz)

    new_by_day = await study_crud.count_new_cards_by_day(
        db, user_id, tz.key, start, end
    )
    reviews_by_day = await study_crud.count_reviewed_tracks_by_day(
        db, user_id, tz.key, start, end
    )

    return {
        day: (new_by_day.get(day, 0), reviews_by_day.get(day, 0))
        for day in set(new_by_day) | set(reviews_by_day)
    }


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

    # Планувальник будується один раз на всю вибірку, а не на кожну доріжку:
    # Scheduler не тримає стану між викликами, а конструктор валідує 21 вагу.
    # Без фазі — інакше два послідовні відкриття черги показали б для тієї самої
    # картки різні прогнози.
    settings = await study_crud.get_user_settings(db, current_user.id)
    scheduler = build_scheduler(settings, enable_fuzzing=False)

    items = [
        QueueItemSchema(
            track_id=track.id,
            kind=track.kind,
            state=track.state,
            due_at=track.due_at,
            card=QueueCardSchema.model_validate(track.card),
            preview=_rating_preview(track, scheduler, now),
        )
        for track in tracks
    ]

    return QueueResponseSchema(
        due_count=due_count,
        new_count=new_count,
        items=items,
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
    "/days/",
    response_model=StudyDaysResponseSchema,
    summary="Calendar of study days",
    description="Days with activity in the range, oldest first. Without from/to — the whole history.",
    status_code=status.HTTP_200_OK,
)
async def get_days(
    date_from: date | None = Query(None, alias="from", description="Включно"),
    date_to: date | None = Query(None, alias="to", description="Включно"),
    current_user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> StudyDaysResponseSchema:
    """
    Календар для екрана прогресу.

    Перед вибіркою дораховує незакриті дні — тим самим правилом, що й /today/.
    Без цього тиждень без заходів у застосунок назавжди лишився б сірим:
    is_goal_met пишеться лише тоді, коли його хтось порахував. Це GET із
    записом, і так само поводиться /today/ — інакше фронтенд мусив би смикати
    /today/ перед кожним відкриттям календаря, інакше той брехав би.

    Кількості в study_days не зберігаються, тож рахуються тут заново з
    cards.created_at і review_logs. Дні без активності у відповідь не
    потрапляють: сітку місяця малює фронтенд.
    """
    settings = await study_crud.get_user_settings(db, current_user.id)
    tz = resolve_timezone(settings.timezone)
    today = local_day(datetime.now(timezone.utc), tz)

    open_days = await study_crud.get_open_study_days(db, current_user.id, today)
    if open_days:
        counts = await _day_counts(db, current_user.id, tz, open_days[0].day, today)
        for row in open_days:
            day_new, day_reviews = counts.get(row.day, (0, 0))
            if is_goal_met(
                new_added=day_new,
                reviews_done=day_reviews,
                new_goal=row.new_goal,
                review_goal=row.review_goal,
            ):
                row.is_goal_met = True
        await db.commit()

    rows = await study_crud.get_study_days(db, current_user.id, date_from, date_to)
    if not rows:
        return StudyDaysResponseSchema(items=[])

    counts = await _day_counts(db, current_user.id, tz, rows[0].day, rows[-1].day)

    return StudyDaysResponseSchema(
        items=[
            StudyDaySchema(
                day=row.day,
                new_goal=row.new_goal,
                review_goal=row.review_goal,
                new_count=counts.get(row.day, (0, 0))[0],
                review_count=counts.get(row.day, (0, 0))[1],
                is_goal_met=row.is_goal_met,
            )
            for row in rows
        ]
    )


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

    `default_list_id` — єдине поле, яке можна занулити: null знімає позначку.
    Решта колонок NOT NULL, і явний null для них раніше давав 500 на
    IntegrityError; тепер він просто ігнорується.
    """
    settings = await study_crud.get_user_settings(db, current_user.id)
    fields = payload.model_dump(exclude_unset=True)

    if fields.get("default_list_id") is not None:
        # Чужий чи неіснуючий список — 422, а не тихе збереження: інакше
        # користувач бачив би «збережено», а нові картки йшли б у порожнечу.
        own = await vocabulary_crud.filter_own_list_ids(
            db, current_user.id, [fields["default_list_id"]]
        )
        if not own:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "unknown_list_ids",
                    "message": "Some list ids do not belong to you.",
                    "list_ids": [fields["default_list_id"]],
                },
            )

    for field, value in fields.items():
        if value is None and field != "default_list_id":
            continue
        setattr(settings, field, value)

    await db.commit()
    await db.refresh(settings)

    return StudySettingsResponseSchema.model_validate(settings)
