from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.models import Base
from app.security.utils import generate_secure_token


if TYPE_CHECKING:
    from app.database.models.accounts import UserModel
    from app.database.models.vocabulary import WordListModel


class ListShareModel(Base):
    """
    Запрошення поділитися списком слів.

    Шеринг тут — КОПІЯ: отримувач створює власні картки і
    власний прогрес, а зміни в оригіналі до нього більше не доходять.

    Слова, які в отримувача вже є, при імпорті не дублюються — наявна картка
    просто отримує ще одну мітку списку.

    recipient_id порожній, якщо це шер за посиланням для будь-кого.
    """

    __tablename__ = "list_shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, default=generate_secure_token
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    list_id: Mapped[int] = mapped_column(
        ForeignKey("word_lists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    recipient_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    word_list: Mapped["WordListModel"] = relationship("WordListModel", back_populates="shares")
    owner: Mapped["UserModel"] = relationship(
        "UserModel", foreign_keys=[owner_id], back_populates="list_shares"
    )
    recipient: Mapped[Optional["UserModel"]] = relationship(
        "UserModel", foreign_keys=[recipient_id]
    )

    def __repr__(self):
        return f"<ListShareModel(id={self.id}, list_id={self.list_id}, is_active={self.is_active})>"
