from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.models import Base, TimestampMixin
from app.database.models.enums import StudyDirectionEnum, ThemeEnum, TtsAccentEnum


if TYPE_CHECKING:
    from app.database.models.accounts import UserModel

DEFAULT_DAILY_NEW_GOAL = 10
DEFAULT_DAILY_REVIEW_GOAL = 30

class UserSettingsModel(Base, TimestampMixin):
    """
    Преференції застосунку: як він виглядає, як озвучує, які цілі.

    Ціль 0 означає «ціль вимкнено».
    """

    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Налаштування зовнішнього вигляду
    theme: Mapped[ThemeEnum] = mapped_column(
        Enum(ThemeEnum), default=ThemeEnum.SYSTEM, nullable=False
    )

    # Налаштування вивчення
    study_direction: Mapped[StudyDirectionEnum] = mapped_column(
        Enum(StudyDirectionEnum), default=StudyDirectionEnum.EN_UK, nullable=False
    )

    # Опції озвучування
    tts_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    tts_autoplay: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    tts_accent: Mapped[TtsAccentEnum] = mapped_column(
        Enum(TtsAccentEnum), default=TtsAccentEnum.AUTO, nullable=False
    )
    tts_slow: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Цілі вивчення
    daily_new_goal: Mapped[int] = mapped_column(
        Integer, default=DEFAULT_DAILY_NEW_GOAL, nullable=False
    )
    daily_review_goal: Mapped[int] = mapped_column(
        Integer, default=DEFAULT_DAILY_REVIEW_GOAL, nullable=False
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    user: Mapped["UserModel"] = relationship("UserModel", back_populates="settings")

    __table_args__ = (UniqueConstraint("user_id", name="uq_user_settings_user"),)

    def __repr__(self):
        return f"<UserSettingsModel(id={self.id}, user_id={self.user_id}, theme={self.theme})>"
