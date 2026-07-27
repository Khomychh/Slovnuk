from typing import Optional, TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Enum,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.models import Base, TimestampMixin
from app.database.models.enums import StudyDirectionEnum, ThemeEnum, TtsAccentEnum


if TYPE_CHECKING:
    from app.database.models.accounts import UserModel

DEFAULT_DAILY_NEW_GOAL = 10
DEFAULT_DAILY_REVIEW_GOAL = 30
DEFAULT_DESIRED_RETENTION = 0.9
DEFAULT_TIMEZONE = "Europe/Kyiv"


class UserSettingsModel(Base, TimestampMixin):
    """
    Преференції застосунку: як він виглядає, як озвучує, які цілі.

    Тут же живуть персональні параметри планувальника — саме тому важкий
    оптимізатор (torch) не потрібен усередині API: він пише сюди, а
    застосунок лише читає. Оптимізатор запускається руками з машини
    розробника і на сервер не потрапляє — див. ADR-0002.

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

    # Цілі вивчення.
    # daily_new_goal — скільки слів ДОДАТИ за добу (рахується з cards.created_at),
    # daily_review_goal — скільки карток ПОВТОРИТИ (рахується з review_logs).
    daily_new_goal: Mapped[int] = mapped_column(
        Integer, default=DEFAULT_DAILY_NEW_GOAL, nullable=False
    )
    daily_review_goal: Mapped[int] = mapped_column(
        Integer, default=DEFAULT_DAILY_REVIEW_GOAL, nullable=False
    )

    # --- планувальник FSRS ---

    # 21 вага, підібрана оптимізатором під конкретну людину. NULL = ще не
    # оптимізували, використовуються дефолти бібліотеки. JSONB, а не 21
    # колонка: у FSRS-4 ваг було 17, у FSRS-5 — 19, у FSRS-6 — 21, і кожен
    # реліз інакше вимагав би міграції.
    fsrs_parameters: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    # Мажорна версія алгоритму (6 для py-fsrs 6.x). Це НЕ запобіжник: від
    # падіння захищає try/except навколо створення Scheduler, бо валідація
    # там ловить і кількість ваг, і вихід за межі. Версія лише підказує,
    # коли варто перезапустити підбір. Кількість ваг сюди не пишемо — її
    # видно з довжини fsrs_parameters.
    fsrs_parameters_version: Mapped[Optional[int]] = mapped_column(
        SmallInteger, nullable=True
    )
    # Цільова ймовірність згадати. Нижче — рідші повторення й більше забувань.
    desired_retention: Mapped[float] = mapped_column(
        Float, default=DEFAULT_DESIRED_RETENTION, nullable=False
    )

    # Часовий пояс IANA. Потрібен не планувальнику (той живе в UTC), а
    # study_days: саме він вирішує, до якої доби належить нічна сесія.
    # StudyDayModel заморожує записи, тож помилка тут не самовиправляється.
    timezone: Mapped[str] = mapped_column(
        String(64), default=DEFAULT_TIMEZONE, nullable=False
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    user: Mapped["UserModel"] = relationship("UserModel", back_populates="settings")

    __table_args__ = (UniqueConstraint("user_id", name="uq_user_settings_user"),)

    def __repr__(self):
        return f"<UserSettingsModel(id={self.id}, user_id={self.user_id}, theme={self.theme})>"
