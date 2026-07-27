from datetime import date, datetime
from typing import List, Optional, TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.models import Base, TimestampMixin
from app.database.models.enums import ReviewKindEnum, ReviewStateEnum


if TYPE_CHECKING:
    from app.database.models.accounts import UserModel
    from app.database.models.vocabulary import CardModel


class ReviewTrackModel(Base, TimestampMixin):
    """
    Незалежний графік повторень.

    У картки їх дві: TRANSLATION (слово ↔ переклад) і FORMS (неправильні
    форми або інші форми слова). Напрямок навчання окремої доріжки не має — Англ→Укр і Укр→Англ
    рухають ту саму TRANSLATION.

    Колонки поділені на три групи: спільні для будь-якого планувальника,
    специфічні для SM-2 і специфічні для FSRS. Зараз заповнюються перші дві;
    stability/difficulty лишаються NULL, доки не буде перемкнено алгоритм.
    """

    __tablename__ = "review_tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[ReviewKindEnum] = mapped_column(Enum(ReviewKindEnum), nullable=False)

    # --- спільне для будь-якого алгоритму ---
    state: Mapped[ReviewStateEnum] = mapped_column(
        Enum(ReviewStateEnum), default=ReviewStateEnum.NEW, nullable=False
    )
    due_on: Mapped[date] = mapped_column(Date, nullable=False)
    last_reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    repetitions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lapses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # --- SM-2 ---
    ease_factor: Mapped[float] = mapped_column(Float, default=2.5, nullable=False)
    interval_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # --- FSRS (поки не використовується) ---
    stability: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    difficulty: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id", ondelete="CASCADE"), nullable=False
    )

    card: Mapped["CardModel"] = relationship("CardModel", back_populates="review_tracks")
    logs: Mapped[List["ReviewLogModel"]] = relationship(
        "ReviewLogModel", back_populates="track", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("card_id", "kind", name="uq_review_tracks_card_kind"),
        Index("ix_review_tracks_due_on", "due_on"),
    )

    def __repr__(self):
        return (
            f"<ReviewTrackModel(id={self.id}, card_id={self.card_id}, "
            f"kind={self.kind}, due_on={self.due_on})>"
        )


class ReviewLogModel(Base):
    """
    Одна відповідь користувача. Записи не редагуються і не видаляються.

    Тримає стан ДО відповіді, бо саме він потрібен оптимізатору FSRS, щоб
    підібрати параметри під конкретну людину.

    user_id тут навмисно продубльований (його можна було б дістати через
    track → card): денна статистика — найчастіший запит, а рядок логу після
    запису вже не змінюється, тож розсинхрону не буде.
    """

    __tablename__ = "review_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # стан доріжки безпосередньо перед цією відповіддю
    state_before: Mapped[ReviewStateEnum] = mapped_column(
        Enum(ReviewStateEnum), nullable=False
    )
    elapsed_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # що ця відповідь призначила
    scheduled_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    due_on_after: Mapped[date] = mapped_column(Date, nullable=False)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    track_id: Mapped[int] = mapped_column(
        ForeignKey("review_tracks.id", ondelete="CASCADE"), nullable=False, index=True
    )

    user: Mapped["UserModel"] = relationship("UserModel", back_populates="review_logs")
    track: Mapped["ReviewTrackModel"] = relationship("ReviewTrackModel", back_populates="logs")

    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 4", name="ck_review_logs_rating_range"),
        Index("ix_review_logs_user_reviewed_at", "user_id", "reviewed_at"),
    )

    def __repr__(self):
        return (
            f"<ReviewLogModel(id={self.id}, track_id={self.track_id}, "
            f"rating={self.rating}, reviewed_at={self.reviewed_at})>"
        )


class StudyDayModel(Base, TimestampMixin):
    """
    Підсумок одного дня навчання.

    Зберігає цілі, які діяли САМЕ ЦЬОГО ДНЯ. Без цього знімка підвищення
    щоденної цілі заднім числом «скасувало б» усі раніше виконані дні.

    Кількості тут не дублюються: нові слова рахуються з cards.created_at,
    повтори — з review_logs.
    """

    __tablename__ = "study_days"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)

    new_goal: Mapped[int] = mapped_column(Integer, nullable=False)
    review_goal: Mapped[int] = mapped_column(Integer, nullable=False)
    is_goal_met: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    user: Mapped["UserModel"] = relationship("UserModel", back_populates="study_days")

    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_study_days_user_day"),)

    def __repr__(self):
        return (
            f"<StudyDayModel(id={self.id}, day={self.day}, is_goal_met={self.is_goal_met})>"
        )
