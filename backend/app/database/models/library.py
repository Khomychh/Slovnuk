"""
Бібліотека — списки, виставлені на загал.

Окремий файл від sharing.py навмисно: Шер віддає список конкретним людям
посиланням і живе живим вмістом, Бібліотека виставляє знімок на витрину й
накопичує рейтинг. Спільного в них лише те, що обидва кінчаються імпортом.

Тут п'ять таблиць, і всі, крім першої, — «рядок на людину» або «рядок на
картку». Логіка, яку можна перевірити без бази, живе в services/library.py.
"""

from datetime import datetime
from typing import List, Optional, TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.models import Base, TimestampMixin
from app.database.models.enums import PublicationReportReasonEnum


if TYPE_CHECKING:
    from app.database.models.accounts import UserModel
    from app.database.models.vocabulary import WordListModel


MAX_PUBLICATION_TITLE_LENGTH = 100
MAX_PUBLICATION_DESCRIPTION_LENGTH = 600

MIN_STARS = 1
MAX_STARS = 5

#: Доки оцінок менше — витрина показує «поки без оцінок», а не число. Одна
#: п'ятірка сказала б про список більше, ніж знає її автор.
RATING_VISIBILITY_THRESHOLD = 3


class PublicationModel(Base, TimestampMixin):
    """
    Список, виставлений у Бібліотеці.

    Це ОКРЕМА сутність, а не стан списку, і не прапорець на ListShareModel.
    Причина конкретна: у шері повторне ввімкнення створює новий рядок, тож
    рейтинг із взяттями осиротів би при кожному «зняв на тиждень і повернув».
    Тут навпаки — рядок один, `is_listed` перемикається туди й назад, а
    `POST` ідемпотентний. Див. ADR-0020.

    Вміст — ЗНІМОК (`publication_cards`), а не живий список: нове слово, кинуте
    в опублікований список, публічним не стає, доки автор не оновить знімок.
    Див. ADR-0019.

    `list_id` та `owner_id` навмисно nullable: публікація переживає і видалення
    списку, і видалення акаунта автора. Тому НІЩО в коді не має права вважати
    їх наявними — ні підпис, ні кнопка «Оновити».
    """

    __tablename__ = "publications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Власні, а не позичені зі списку: «Загальний» — нормальна назва для себе й
    # нікчемна на витрині, а перейменувати свій список автор має право будь-коли.
    title: Mapped[str] = mapped_column(
        String(MAX_PUBLICATION_TITLE_LENGTH), nullable=False
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_listed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Коли останній раз замінювали ЗНІМОК. Окремо від updated_at із TimestampMixin
    # навмисно: той бумкає і від правки опису, і від перемикання is_listed, а
    # витрина мусить казати «оновлено 30 липня» саме про вміст.
    content_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Без index=True: UniqueConstraint("list_id") нижче сам створює унікальний
    # індекс на цій колонці, тож окремий був би дублем, за який платять записи.
    list_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("word_lists.id", ondelete="SET NULL"), nullable=True
    )
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Не NULL лише тоді, коли публікацію зняв МОДЕРАТОР, а не автор. Різниця не
    # косметична: зняте модератором автор не має права ввімкнути назад, тож
    # `is_listed=false` сам по собі не каже, чи можна публікувати знову.
    hidden_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Публікація списку, який сам приїхав із Бібліотеки. Копіюється сюди з
    # word_lists.imported_from_publication_id у момент публікації, а не читається
    # звідти щоразу: список можуть видалити, і тоді провенанс загубився б.
    derived_from_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("publications.id", ondelete="SET NULL"), nullable=True
    )

    # Усі три — односторонні many-to-one, БЕЗ зворотних колекцій на UserModel і
    # WordListModel. Так само зроблено WordListModel.imported_from_user, і з тієї
    # ж причини: зворотна колекція на FK із SET NULL змусила б SQLAlchemy нулити
    # ці посилання в Python, вантажачи всі публікації користувача, — замість того
    # щоб дати це зробити базі одним ON DELETE SET NULL.
    #
    # «Мої публікації» — це запит із WHERE owner_id, а не колекція на об'єкті:
    # екран усе одно гортає сторінками.
    word_list: Mapped[Optional["WordListModel"]] = relationship(
        "WordListModel", foreign_keys=[list_id]
    )
    owner: Mapped[Optional["UserModel"]] = relationship(
        "UserModel", foreign_keys=[owner_id]
    )
    hidden_by: Mapped[Optional["UserModel"]] = relationship(
        "UserModel", foreign_keys=[hidden_by_id]
    )
    derived_from: Mapped[Optional["PublicationModel"]] = relationship(
        "PublicationModel", remote_side=[id]
    )

    cards: Mapped[List["PublicationCardModel"]] = relationship(
        "PublicationCardModel",
        back_populates="publication",
        cascade="all, delete-orphan",
        order_by="PublicationCardModel.position",
    )
    takes: Mapped[List["PublicationTakeModel"]] = relationship(
        "PublicationTakeModel", back_populates="publication", cascade="all, delete-orphan"
    )
    ratings: Mapped[List["PublicationRatingModel"]] = relationship(
        "PublicationRatingModel",
        back_populates="publication",
        cascade="all, delete-orphan",
    )
    reports: Mapped[List["PublicationReportModel"]] = relationship(
        "PublicationReportModel",
        back_populates="publication",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # У списку публікація щонайбільше одна. NULL тут не конфліктує сам із
        # собою в Postgres, тож осиротілих (list_id IS NULL) може бути скільки
        # завгодно — і це правильно.
        UniqueConstraint("list_id", name="uq_publications_list"),
        # Витрина завжди відбирає лише виставлені, і сортує по трьох речах. Цей
        # індекс покриває найдорожче з них — «нові зверху».
        Index("ix_publications_listed_fresh", "is_listed", "content_updated_at"),
    )

    def __repr__(self):
        return (
            f"<PublicationModel(id={self.id}, title={self.title!r}, "
            f"is_listed={self.is_listed})>"
        )


class PublicationCardModel(Base):
    """
    Одна картка знімка.

    TimestampMixin тут НЕ використовується: знімок замінюється цілком, а не
    правиться по рядках, тож created_at на картці брехав би про вік вмісту.
    Правду каже `publications.content_updated_at`.

    Слово, коментар і позиція лежать у колонках, а значення з прикладами й форми
    — у `content`. Лінія проведена за тим, чим база шукає й сортує: по слову
    звіряють, чого в отримувача вже немає, по позиції гортають сторінками, а
    значення й форми читають та перезаписують лише цілою карткою. Див. ADR-0019.

    Знімок НЕ можна зберігати як звичайні CardModel: `cards` тримає
    UNIQUE(user_id, word_normalized), тож власник фізично не може мати другу
    копію свого ж слова.
    """

    __tablename__ = "publication_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    publication_id: Mapped[int] = mapped_column(
        ForeignKey("publications.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    word: Mapped[str] = mapped_column(String(100), nullable=False)
    word_normalized: Mapped[str] = mapped_column(String(100), nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # {"senses": [SharedSenseSchema...], "forms": [SharedFormSchema...]}
    #
    # Форма не вигадана: це рівно те, що API вже віддає в перегляді чужого
    # списку. Отже той самий контракт перевіряється двома шляхами, а не двома
    # різними контрактами описують одне.
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)

    publication: Mapped["PublicationModel"] = relationship(
        "PublicationModel", back_populates="cards"
    )

    __table_args__ = (
        # Джерело — список, а там UNIQUE(user_id, word_normalized), тож дублів у
        # знімку бути не може. Констрейнт це не стільки захищає, скільки заявляє:
        # писар знімка, який продублює слово, впаде тут, а не тихо зіпсує звірку
        # з чужим словником.
        UniqueConstraint(
            "publication_id", "word_normalized", name="uq_publication_cards_word"
        ),
        # Гортання сторінками: WHERE publication_id = ? ORDER BY position.
        # Окремого індексу на publication_id не треба — цей його покриває.
        Index("ix_publication_cards_page", "publication_id", "position"),
    )

    def __repr__(self):
        return (
            f"<PublicationCardModel(publication_id={self.publication_id}, "
            f"word={self.word!r})>"
        )


class PublicationTakeModel(Base):
    """
    Факт того, що людина взяла публікацію.

    Складений первинний ключ, як у CardListLinkModel: одне взяття на людину,
    скільком би списками вона це не розклала. Саме тому популярність — це
    COUNT(*), а не COUNT(DISTINCT ...), і читається без пасток.

    Тримає дві речі одночасно: популярність і право поставити зірки. Другого
    сховища для «чи я брав» немає й не потрібно.

    `taken_at` — час ПЕРШОГО взяття, повторне його не бумкає: повторне взяття
    вже наявного списку не є новим охопленням. Колонка потрібна для «популярні
    за 30 днів», яких на витрині ще немає, — але без неї їх не порахувати вже
    ніколи.

    CASCADE на user_id свідомий: пішовши з застосунку, людина більше не має
    цього списку, тож 128 мусить стати 127. Публікацію ж видалення акаунта
    АВТОРА не чіпає — там SET NULL, див. ADR-0020.
    """

    __tablename__ = "publication_takes"

    publication_id: Mapped[int] = mapped_column(
        ForeignKey("publications.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    taken_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    publication: Mapped["PublicationModel"] = relationship(
        "PublicationModel", back_populates="takes"
    )
    # Односторонній: «що взяв цей користувач» ніде не питається з боку
    # користувача, а зайва колекція на UserModel виглядала б як функція.
    # Видалення акаунта прибирає ці рядки самою базою (CASCADE).
    user: Mapped["UserModel"] = relationship("UserModel")

    def __repr__(self):
        return (
            f"<PublicationTakeModel(publication_id={self.publication_id}, "
            f"user_id={self.user_id})>"
        )


class PublicationRatingModel(Base, TimestampMixin):
    """
    Зірки, які людина поставила публікації.

    Ставити може лише той, у кого є рядок у PublicationTakeModel — рейтинг
    означає «я цим користувався», а не «мені сподобалась назва». Перевірка живе
    в роуті: тут її виразити нічим, бо складений FK на takes зробив би
    неможливим збереження оцінки після видалення взятого списку, а воно
    навмисно лишається.

    Складений PK: одна людина — одна оцінка, змінити її можна, накрутити ні.
    TimestampMixin тут потрібен саме через це: `updated_at` каже, коли думку
    змінили.

    Межі 1–5 стоять І в базі. Це навмисна відмова від того, як зроблено
    `desired_retention`, де межі тримає лише Pydantic-схема — HANDOFF називає це
    дірою, і повторювати її тут немає підстав.
    """

    __tablename__ = "publication_ratings"

    publication_id: Mapped[int] = mapped_column(
        ForeignKey("publications.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    stars: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    publication: Mapped["PublicationModel"] = relationship(
        "PublicationModel", back_populates="ratings"
    )
    user: Mapped["UserModel"] = relationship("UserModel")

    __table_args__ = (
        CheckConstraint(
            f"stars BETWEEN {MIN_STARS} AND {MAX_STARS}",
            name="ck_publication_ratings_stars",
        ),
    )

    def __repr__(self):
        return (
            f"<PublicationRatingModel(publication_id={self.publication_id}, "
            f"user_id={self.user_id}, stars={self.stars})>"
        )


class PublicationReportModel(Base):
    """
    Скарга на публікацію.

    Причина — із закритого набору, вільного тексту немає навмисно (див.
    PublicationReportReasonEnum). Складений PK: скарги важать людьми, а не
    натисканнями.

    Екрана модератора поки немає — скарги читаються запитом:

        SELECT publication_id, reason, COUNT(*)
        FROM publication_reports GROUP BY 1, 2 ORDER BY 3 DESC;

    Це свідома межа першої версії: черга модерації для нуля скарг була б
    роботою, порівнянною з усією рештою Бібліотеки.
    """

    __tablename__ = "publication_reports"

    publication_id: Mapped[int] = mapped_column(
        ForeignKey("publications.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    reason: Mapped[PublicationReportReasonEnum] = mapped_column(
        Enum(PublicationReportReasonEnum), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    publication: Mapped["PublicationModel"] = relationship(
        "PublicationModel", back_populates="reports"
    )
    user: Mapped["UserModel"] = relationship("UserModel")

    def __repr__(self):
        return (
            f"<PublicationReportModel(publication_id={self.publication_id}, "
            f"reason={self.reason})>"
        )
