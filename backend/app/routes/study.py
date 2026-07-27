from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fsrs import Rating
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.database import get_db
from app.database.models import (
    CardModel,
    ReviewLogModel,
    ReviewTrackModel,
    UserModel,
    UserSettingsModel,
)
from app.schemas.study import TrackReviewRequestSchema, TrackReviewResponseSchema
from app.security.dependencies import get_current_authenticated_user
from app.services.scheduler import review_track

router = APIRouter()


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
    підтверджувати факт існування чужого track_id. Рядок блокується
    (`FOR UPDATE`) на час транзакції, щоб дві одночасні відповіді на ту саму
    доріжку не перезаписали стан одна одної.
    """
    stmt = (
        select(ReviewTrackModel)
        .join(CardModel, ReviewTrackModel.card_id == CardModel.id)
        .where(ReviewTrackModel.id == track_id, CardModel.user_id == current_user.id)
        .with_for_update(of=ReviewTrackModel)
    )
    result = await db.execute(stmt)
    track = result.scalars().first()
    if not track:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "track_not_found", "message": "Review track not found."},
        )

    # current_user.settings — лінива relationship, звертатись напряму до неї
    # в persistent-об'єкта поза eager-load ризикує MissingGreenlet, тому
    # явний окремий SELECT замість `current_user.settings`.
    settings_stmt = select(UserSettingsModel).where(
        UserSettingsModel.user_id == current_user.id
    )
    settings = (await db.execute(settings_stmt)).scalars().one()

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

    await db.commit()
    await db.refresh(track)

    return TrackReviewResponseSchema.model_validate(track)
