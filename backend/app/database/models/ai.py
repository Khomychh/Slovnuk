from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.models import Base
from app.database.models.enums import AiRequestOutcomeEnum


if TYPE_CHECKING:
    from app.database.models.accounts import UserModel


class AiAccessModel(Base):
    """
    Доступ до ШІ: рядок є — доступ є.

    Це привілей, а не роль (ADR-0026). Саме тому окрема таблиця, а не ще одне
    значення в user_groups: група в цьому застосунку відповідає на питання «хто
    ти в системі», і вона одна на людину. Доступ до ШІ ортогональний до неї —
    адміністратор із доступом і адміністратор без нього мають бути однаково
    можливі.

    user_id первинним ключем, а не окремим id: так «одна видача на людину»
    гарантується типом даних, а не домовленістю. Зняття доступу — DELETE, а не
    прапорець: усе, що варто пам'ятати про витрати, уже лежить у ai_requests і
    видалення цього рядка не чіпає.
    """

    __tablename__ = "ai_access"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Хто видав. SET NULL: адміністратор може піти, а виданий ним доступ
    # лишається чинним — його знімають рішенням, а не звільненням.
    granted_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Навіщо видано. Заповнює команда; читатиме майбутня адмінка, щоб на питання
    # «а чому в цієї людини є ШІ» була відповідь, а не здогад.
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user: Mapped["UserModel"] = relationship(
        "UserModel", foreign_keys=[user_id], back_populates="ai_access"
    )
    granted_by: Mapped[Optional["UserModel"]] = relationship(
        "UserModel", foreign_keys=[granted_by_user_id]
    )

    def __repr__(self):
        return f"<AiAccessModel(user_id={self.user_id}, granted_at={self.granted_at})>"


class AiRequestModel(Base):
    """
    Звернення — незмінний слід одного виклику ШІ.

    Дві ролі в одній таблиці, і це свідомо (ADR-0028):

    1. Облік. Єдине джерело правди про витрати. Заднім числом не відновлюється:
       не записав — не дізнаєшся ніколи, чиї це гроші. Тому пишеться і при
       невдачі теж — вхідні токени за неї теж оплачені.
    2. Запобіжник. «Одне звернення на слово» перевіряється запитом сюди:
       чи є для цього user_id + word_normalized рядок з outcome != ERROR.

    TimestampMixin тут навмисно НЕ використовується: updated_at на записі, який
    ніколи не редагується, був би брехнею — так само, як у ReviewLogModel.

    Поки що виходу з блокування немає. Коли знадобиться, це буде колонка
    superseded_at, яку запит обмеження почне ігнорувати, — а не видалення рядка:
    інакше розблокування стирало б доказ витрат.
    """

    __tablename__ = "ai_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # CASCADE, як усе інше в акаунті: пішовши, людина забирає з собою і свої
    # звернення. Ціна відома — витрати зниклого акаунта зникають із журналу.
    #
    # Без index=True: складений ix_ai_requests_user_word нижче починається з цієї
    # ж колонки, тож окремий індекс на неї був би другою копією тих самих даних.
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # Слово як його ввели — щоб у журналі було видно, що саме людина набирала.
    word: Mapped[str] = mapped_column(String(100), nullable=False)
    # Ключ обмеження. Той самий normalize_word(), що тримає
    # UNIQUE(user_id, word_normalized) на картках, тож «Run» і «run » — одне
    # слово тут і там однаково.
    word_normalized: Mapped[str] = mapped_column(String(100), nullable=False)

    # Яка модель відповідала. Живе в рядку, а не виводиться з налаштувань:
    # налаштування міняються, а рахунок стосується того, що працювало тоді.
    model: Mapped[str] = mapped_column(String(64), nullable=False)

    # NULL при ERROR: коли Claude не відповів, лічильника токенів немає.
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    outcome: Mapped[AiRequestOutcomeEnum] = mapped_column(
        Enum(AiRequestOutcomeEnum), nullable=False
    )
    # Заповнюється тільки при ERROR: тип збою, щоб «чому рахунок більший, ніж
    # успіхів» мало відповідь без читання логів застосунку.
    error_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["UserModel"] = relationship("UserModel", back_populates="ai_requests")

    __table_args__ = (
        # Складений індекс під єдиний гарячий запит: «чи вже палили це слово».
        # Окремого ix_ai_requests_user_id досить було б для звітів, але не для
        # нього — а він виконується перед кожним зверненням.
        Index("ix_ai_requests_user_word", "user_id", "word_normalized"),
    )

    def __repr__(self):
        return (
            f"<AiRequestModel(id={self.id}, user_id={self.user_id}, "
            f"word={self.word!r}, outcome={self.outcome})>"
        )
