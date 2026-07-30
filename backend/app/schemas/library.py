"""
Схеми Бібліотеки.

Дві речі тут вирішені так, що на це варто звернути увагу.

**Рейтинг віддається вже прихованим.** `rating` дорівнює None, коли оцінок менше
за RATING_VISIBILITY_THRESHOLD, — і клієнт не знає й не мусить знати, чому. Якби
сервер віддавав середнє завжди, поріг довелося б повторити на фронтенді, і два
місця розійшлися б; а «4.9 з однієї оцінки» вище за «4.6 з тридцяти» — це не
рейтинг, а шум. `ratings_count` при цьому чесний завжди.

**Знімок віддається без жодного `id`.** Як і в схемах шерингу: картка в перегляді
публікації — це вміст, а не рядок, на який можна послатися. Виняток один — сама
публікація, бо її беруть, оцінюють і на неї скаржаться.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.database.models import (
    MAX_PUBLICATION_DESCRIPTION_LENGTH,
    MAX_PUBLICATION_TITLE_LENGTH,
    MAX_STARS,
    MIN_STARS,
    PublicationReportReasonEnum,
)
from app.schemas.sharing import SharedFormSchema, SharedSenseSchema
from app.schemas.vocabulary import MAX_LIST_NAME_LENGTH, OptionalText, RequiredText


# --------------------------------------------------------------------------
# Знімок
# --------------------------------------------------------------------------


class SnapshotContentSchema(BaseModel):
    """
    Вміст картки знімка — те, що лежить у `publication_cards.content`.

    Це КОНТРАКТ КОЛОНКИ, а не відповіді API, і саме тому він зібраний із наявних
    SharedSenseSchema / SharedFormSchema, а не описаний заново. Знімок і перегляд
    чужого списку віддають однакову форму; описавши її двома схемами, ми отримали б
    два описи одного, які розходяться при першій же зміні структури картки.

    Обидва поля мають дефолт: картка без значень і без форм — законний стан
    словника, і знімок не має права бути суворішим за нього.
    """

    senses: list[SharedSenseSchema] = Field(default_factory=list)
    forms: list[SharedFormSchema] = Field(default_factory=list)


class SnapshotCardSchema(BaseModel):
    """
    Одне слово публікації очима читача.

    `already_have` рахується проти твого словника за нормалізованим словом і
    означає рівно те, що станеться при взятті: таку картку буде пропущено. Режиму
    «перезаписати» в Бібліотеці немає (CONTEXT: «Перезапис при імпорті»), тож
    інших наслідків у цього прапорця бути не може.
    """

    word: str
    comment: str | None
    senses: list[SharedSenseSchema]
    forms: list[SharedFormSchema]
    already_have: bool


class SnapshotCardPageSchema(BaseModel):
    total: int
    page: int
    per_page: int
    items: list[SnapshotCardSchema]


# --------------------------------------------------------------------------
# Витрина
# --------------------------------------------------------------------------


class PublicationSummarySchema(BaseModel):
    """
    Рядок витрини.

    `author` — ім'я та прізвище з профілю, зібрані в один рядок; None означає, що
    автор видалив акаунт (ADR-0020), а не що він не заповнив профіль: без імені й
    прізвища опублікувати не можна взагалі. Пошта не віддається ніколи.

    `takes_count` і `rating` кажуть різне і навмисно стоять поруч: перше — охоплення,
    друге — якість. Список, який узяли 128 разів і оцінили на 3.2, популярний і
    посередній одночасно, і вибирати має людина.

    `derived_from_title` не порожній у похідної публікації — списку, який сам
    приїхав із Бібліотеки. Позначка обов'язкова: без неї витрина заповнюється
    копіями, а через пропуск наявних копія ще й неповна проти оригіналу.
    """

    id: int
    title: str
    description: str | None
    author: str | None

    #: Перші кілька слів списку — те, що читач насправді вибирає.
    #:
    #: Витрина показує їх замість опису: чотири справжні слова кажуть про рівень і
    #: тему більше, ніж будь-яке речення автора, а місця займають один рядок.
    #: Опис лишається в схемі, бо його читають на сторінці публікації.
    sample_words: list[str]

    cards_count: int
    takes_count: int
    rating: float | None
    ratings_count: int

    content_updated_at: datetime
    derived_from_title: str | None

    #: Чи є в цього глядача рядок у publication_takes. На витрині це «взято ✓».
    is_taken: bool


class LibraryPageSchema(BaseModel):
    total: int
    page: int
    per_page: int
    items: list[PublicationSummarySchema]


class PublicationDetailSchema(PublicationSummarySchema):
    """
    Сторінка публікації.

    Понад витрину тут те, що потрібно для трьох кнопок — «Взяти», зірки, скарга.

    `new_cards` — скільки слів справді з'явиться. Саме воно, а не `cards_count`,
    чесно описує наслідок кнопки: у списку з 540 слів, 45 із яких у тебе вже є,
    додасться 495.

    `own_stars` порожній, доки ти не оцінював. `can_rate` — це «є рядок у
    publication_takes», тобто право, а не запрошення: воно лишається й після того,
    як ти видалив узятий список, бо ти справді брав.

    `suggested_name` — вільна назва для списку, підказана заздалегідь. Взяття із
    зайнятою назвою відповідає 409, як і POST /lists/, але впертись у помилку після
    підтвердження неприємно.
    """

    new_cards: int
    suggested_name: str

    can_rate: bool
    own_stars: int | None

    #: Чи скаржився вже цей глядач. Друга скарга — не помилка, а просто нічого:
    #: скарги важать людьми, а не натисканнями.
    own_report: PublicationReportReasonEnum | None


# --------------------------------------------------------------------------
# Очима власника
# --------------------------------------------------------------------------


class PublicationWriteSchema(BaseModel):
    """
    Назва й опис — власні, не позичені зі списку.

    «Загальний» — нормальна назва для себе й нікчемна на витрині, а перейменувати
    свій список автор має право будь-коли. Назва списку підставляється як чернетка
    у формі, але далі живе окремо.

    Довжину опису тримає лише ця схема — колонка в базі `Text`. Це свідома
    розбіжність із зірками, де межі стоять і в базі: там число з-поза меж тихо
    псує сортування витрини, а задовгий опис лише погано виглядає.
    """

    title: RequiredText = Field(max_length=MAX_PUBLICATION_TITLE_LENGTH)
    description: OptionalText = Field(
        default=None, max_length=MAX_PUBLICATION_DESCRIPTION_LENGTH
    )

    model_config = ConfigDict(extra="forbid")


class PublicationOwnerSchema(BaseModel):
    """
    Публікація очима автора.

    `is_listed` тут не «видалено чи ні», а «видно на витрині»: рядок живе далі, і
    повернення — це той самий рядок разом із рейтингом (ADR-0020).

    `hidden_by_moderator` відрізняє «я сам зняв» від «зняли мене». Різниця не
    косметична: зняте модератором автор не має права ввімкнути назад, тож
    `is_listed=false` сам по собі не каже, чи кнопка «Опублікувати» щось зробить.

    `can_update` дорівнює «джерело ще існує». Після видалення власного списку
    публікація живе, але оновити її вже нема з чого.

    `list_cards_count` — скільки слів у списку ЗАРАЗ, проти `cards_count` у
    знімку. Різниця чисел — єдиний сигнал застарілості, який ми даємо, і він
    неповний навмисно: виправлений в одному слові переклад кількості не змінює.
    Порівнювати вміст цілком означало б тягти весь знімок на кожне відкриття
    екрана списку.
    """

    id: int
    title: str
    description: str | None

    is_listed: bool
    hidden_by_moderator: bool
    can_update: bool

    cards_count: int
    list_cards_count: int | None

    takes_count: int
    rating: float | None
    ratings_count: int

    content_updated_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# Дії читача
# --------------------------------------------------------------------------


class PublicationTakeSchema(BaseModel):
    """
    Назву задає той, хто бере, а не автор: у нього свій словник і свої звички
    називати списки.

    Поля `mode` тут немає, і це не забуте — режим «перезаписати мої картки» в
    Бібліотеці не існує. У шері він доречний, бо ти знаєш, від кого береш; тут на
    іншому кінці незнайомець, а ціна помилки — роки власних перекладів.
    """

    name: RequiredText = Field(max_length=MAX_LIST_NAME_LENGTH)

    model_config = ConfigDict(extra="forbid")


class PublicationTakeResultSchema(BaseModel):
    """
    Звіт про взяття.

    `overwritten` тут немає — нічого перезаписати не могло. Решта дзеркалить
    ShareImportResultSchema, включно з `skipped_words`: неповнота, про яку не
    сказали, читається як загублені слова.

    `list_id` порожній, коли списку не створювали, — так буває, якщо всі слова в
    тебе вже є. Порожній іменований список у словнику був би сміттям.
    """

    list_id: int | None
    name: str
    created: int
    skipped: int
    skipped_words: list[str]


class RatingWriteSchema(BaseModel):
    """
    Зірки. Ставити може лише той, у кого є взяття.

    Межі стоять і тут, і в базі (`ck_publication_ratings_stars`) — навмисна
    відмова від того, як зроблено desired_retention, де їх тримає лише схема.
    """

    stars: Annotated[int, Field(ge=MIN_STARS, le=MAX_STARS)]

    model_config = ConfigDict(extra="forbid")


class RatingSchema(BaseModel):
    """Стан рейтингу після твоєї оцінки — щоб екран не перезапитував публікацію."""

    rating: float | None
    ratings_count: int
    own_stars: int


class ReportWriteSchema(BaseModel):
    """
    Скарга: причина з закритого набору й нічого більше.

    Поля для розповіді немає навмисно — вільний текст у публічному місці сам стає
    тим, що треба модерувати.
    """

    reason: PublicationReportReasonEnum

    model_config = ConfigDict(extra="forbid")
