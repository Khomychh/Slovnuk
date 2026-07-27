from datetime import datetime
from typing import List, Optional, TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database.models import Base, TimestampMixin
from app.database.models.enums import ContentSourceEnum, PartOfSpeechEnum


if TYPE_CHECKING:
    from app.database.models.accounts import UserModel
    from app.database.models.study import ReviewTrackModel
    from app.database.models.sharing import ListShareModel


def normalize_word(word: str) -> str:
    """
    Ключ, за яким слова вважаються однаковими.

    Відповідає norm() зі старого PWA: обрізані пробіли + нижній регістр.
    Саме ця форма тримає UNIQUE(user_id, word_normalized).
    """
    return (word or "").strip().lower()


class WordListModel(Base, TimestampMixin):
    """
    Іменована група слів.

    Список — це мітка, а не папка: картка може лежати в кількох списках
    одночасно або не лежати в жодному. Видалення списку ніколи не видаляє слів.
    """

    __tablename__ = "word_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Заповнюється, коли список приїхав із чужого шеру. Переживає видалення
    # самого шеру — тому це окремі колонки, а не FK на list_shares.
    imported_from_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    imported_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped["UserModel"] = relationship("UserModel", foreign_keys=[user_id], back_populates="word_lists")
    imported_from_user: Mapped[Optional["UserModel"]] = relationship(
        "UserModel", foreign_keys=[imported_from_user_id]
    )

    card_links: Mapped[List["CardListLinkModel"]] = relationship(
        "CardListLinkModel", back_populates="word_list", cascade="all, delete-orphan"
    )
    cards: Mapped[List["CardModel"]] = relationship(
        "CardModel", secondary="card_list_links", back_populates="word_lists", viewonly=True
    )
    shares: Mapped[List["ListShareModel"]] = relationship(
        "ListShareModel", back_populates="word_list", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_word_lists_user_name"),)

    def __repr__(self):
        return f"<WordListModel(id={self.id}, name={self.name})>"


class CardModel(Base, TimestampMixin):
    """
    Одне слово у словнику користувача.

    Слово унікальне в межах користувача незалежно від списків — дублікатів
    між групами не буває. Прогрес повторень тут не зберігається, він у
    ReviewTrackModel.
    """

    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    word: Mapped[str] = mapped_column(String(100), nullable=False)
    word_normalized: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Форми показуються завжди; прапорець керує лише тим, чи тренувати їх окремо.
    # Доріжка ReviewKindEnum.FORMS при вимкненні не видаляється — прогрес не губиться.
    forms_drill_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    user: Mapped["UserModel"] = relationship("UserModel", back_populates="cards")

    list_links: Mapped[List["CardListLinkModel"]] = relationship(
        "CardListLinkModel", back_populates="card", cascade="all, delete-orphan"
    )
    word_lists: Mapped[List["WordListModel"]] = relationship(
        "WordListModel", secondary="card_list_links", back_populates="cards", viewonly=True
    )

    senses: Mapped[List["WordSenseModel"]] = relationship(
        "WordSenseModel",
        back_populates="card",
        cascade="all, delete-orphan",
        order_by="WordSenseModel.position",
    )
    forms: Mapped[List["WordFormModel"]] = relationship(
        "WordFormModel",
        back_populates="card",
        cascade="all, delete-orphan",
        order_by="WordFormModel.position",
    )
    review_tracks: Mapped[List["ReviewTrackModel"]] = relationship(
        "ReviewTrackModel", back_populates="card", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "word_normalized", name="uq_cards_user_word"),
    )

    @validates("word")
    def _sync_word_normalized(self, key, value):
        value = (value or "").strip()
        self.word_normalized = normalize_word(value)
        return value

    def __repr__(self):
        return f"<CardModel(id={self.id}, word={self.word})>"


class CardListLinkModel(Base):
    """Звʼязок «картка лежить у списку». Складений первинний ключ."""

    __tablename__ = "card_list_links"

    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True
    )
    list_id: Mapped[int] = mapped_column(
        ForeignKey("word_lists.id", ondelete="CASCADE"), primary_key=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    card: Mapped["CardModel"] = relationship("CardModel", back_populates="list_links")
    word_list: Mapped["WordListModel"] = relationship("WordListModel", back_populates="card_links")

    def __repr__(self):
        return f"<CardListLinkModel(card_id={self.card_id}, list_id={self.list_id})>"


class WordSenseModel(Base, TimestampMixin):
    """
    Одне значення слова.

    У слова їх може бути кілька: «run» як дієслово і як іменник — це два
    записи з різними part_of_speech, перекладом і прикладами.
    """

    __tablename__ = "word_senses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    part_of_speech: Mapped[Optional[PartOfSpeechEnum]] = mapped_column(
        Enum(PartOfSpeechEnum), nullable=True
    )
    translation: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    gloss: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    transcription: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    source: Mapped[ContentSourceEnum] = mapped_column(
        Enum(ContentSourceEnum), default=ContentSourceEnum.USER, nullable=False
    )

    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )

    card: Mapped["CardModel"] = relationship("CardModel", back_populates="senses")
    examples: Mapped[List["SenseExampleModel"]] = relationship(
        "SenseExampleModel",
        back_populates="sense",
        cascade="all, delete-orphan",
        order_by="SenseExampleModel.position",
    )

    def __repr__(self):
        return f"<WordSenseModel(id={self.id}, translation={self.translation})>"


class SenseExampleModel(Base, TimestampMixin):
    """Приклад вживання: англійське речення та (необовʼязково) переклад."""

    __tablename__ = "sense_examples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    text_en: Mapped[str] = mapped_column(Text, nullable=False)
    text_uk: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    source: Mapped[ContentSourceEnum] = mapped_column(
        Enum(ContentSourceEnum), default=ContentSourceEnum.USER, nullable=False
    )

    sense_id: Mapped[int] = mapped_column(
        ForeignKey("word_senses.id", ondelete="CASCADE"), nullable=False, index=True
    )

    sense: Mapped["WordSenseModel"] = relationship("WordSenseModel", back_populates="examples")

    def __repr__(self):
        return f"<SenseExampleModel(id={self.id}, text_en={self.text_en[:30]!r})>"


class WordFormModel(Base, TimestampMixin):
    """
    Одна форма слова: label «Past», value «went».

    Мітка — вільний текст, бо набір форм у різних слів різний.
    """

    __tablename__ = "word_forms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    label: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    value: Mapped[str] = mapped_column(String(100), nullable=False)
    transcription: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )

    card: Mapped["CardModel"] = relationship("CardModel", back_populates="forms")

    def __repr__(self):
        return f"<WordFormModel(id={self.id}, label={self.label}, value={self.value})>"
