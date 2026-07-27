from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.database.models import ReviewKindEnum, ReviewStateEnum


class TrackReviewRequestSchema(BaseModel):
    rating: int = Field(ge=1, le=4, description="1=Не згадав, 2=Важко, 3=Добре, 4=Легко")
    review_duration: int | None = Field(
        default=None, ge=0, description="Мілісекунди від показу картки до оцінки"
    )


class TrackReviewResponseSchema(BaseModel):
    track_id: int
    kind: ReviewKindEnum
    state: ReviewStateEnum
    due_at: datetime
    stability: float | None
    difficulty: float | None

    model_config = ConfigDict(from_attributes=True)
