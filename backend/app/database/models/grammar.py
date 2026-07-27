from typing import List, Optional, TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.models import Base, TimestampMixin


if TYPE_CHECKING:
    from app.database.models.accounts import UserModel


class NoteCategoryModel(Base, TimestampMixin):
    """
    Розділ граматичних нотаток («Часи», «Артиклі»).

    Окрема таблиця, а не текст усередині нотатки: назва зберігається один
    раз, її можна перейменувати одним UPDATE, і друкарська помилка не
    породжує фантомний розділ.
    """

    __tablename__ = "note_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    user: Mapped["UserModel"] = relationship("UserModel", back_populates="note_categories")
    notes: Mapped[List["GrammarNoteModel"]] = relationship(
        "GrammarNoteModel", back_populates="category", order_by="GrammarNoteModel.position"
    )

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_note_categories_user_name"),)

    def __repr__(self):
        return f"<NoteCategoryModel(id={self.id}, name={self.name})>"


class GrammarNoteModel(Base, TimestampMixin):
    """
    Нотатка з граматики. Тіло — Markdown, рендериться на фронтенді.

    Нотатки не беруть участі в повтореннях: це довідник.
    """

    __tablename__ = "grammar_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body_markdown: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Видалення розділу не видаляє нотаток — вони просто лишаються без розділу.
    category_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("note_categories.id", ondelete="SET NULL"), nullable=True, index=True
    )

    user: Mapped["UserModel"] = relationship("UserModel", back_populates="grammar_notes")
    category: Mapped[Optional["NoteCategoryModel"]] = relationship(
        "NoteCategoryModel", back_populates="notes"
    )

    def __repr__(self):
        return f"<GrammarNoteModel(id={self.id}, title={self.title})>"
