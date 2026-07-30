"""
Схеми словника.

Читання і запис тут навмисно різні типи. У відповіді id завжди є, у запиті він
опційний (None = «створити»), а порожні значення й форми до бази не доходять
взагалі — їх відсіює валідатор, а не роут.
"""

from datetime import datetime
from typing import Annotated, Any, TypeVar

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
)

from app.database.models import PartOfSpeechEnum, ReviewKindEnum, ReviewStateEnum
from app.services.vocabulary import is_blank

MAX_WORD_LENGTH = 100
MAX_LIST_NAME_LENGTH = 100


def _blank_to_none(value: Any) -> Any:
    """Порожній рядок з форми — це «не заповнено», а не значення."""
    if not isinstance(value, str):
        return value
    return value.strip() or None


def _stripped(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    return value.strip()


def _not_blank(value: str) -> str:
    if not value:
        raise ValueError("Value must not be blank.")
    return value


# Обрізаємо ДО перевірки довжини, інакше рядок із хвостом пробілів впирався б
# у max_length там, де насправді вміщується.
OptionalText = Annotated[str | None, BeforeValidator(_blank_to_none)]
RequiredText = Annotated[
    str, BeforeValidator(_stripped), AfterValidator(_not_blank)
]

Child = TypeVar("Child")


def _drop_blank(items: list[Child]) -> list[Child]:
    """
    Прибрати дітей, у яких не заповнено нічого.

    Робиться саме тут, а не в роуті: порожній рядок форми не має ставати рядком
    у базі, і жодна гілка коду не повинна про це пам'ятати окремо.
    """
    return [item for item in items if not item.is_blank]


# --------------------------------------------------------------------------
# Читання
# --------------------------------------------------------------------------


class SenseExampleSchema(BaseModel):
    id: int
    text_en: str
    text_uk: str | None

    model_config = ConfigDict(from_attributes=True)


class WordSenseSchema(BaseModel):
    id: int
    part_of_speech: PartOfSpeechEnum | None
    translation: str | None
    transcription: str | None
    examples: list[SenseExampleSchema]

    model_config = ConfigDict(from_attributes=True)


class WordFormSchema(BaseModel):
    id: int
    label: str | None
    value: str
    transcription: str | None

    model_config = ConfigDict(from_attributes=True)


class CardTrackSchema(BaseModel):
    """
    Доріжка повторення в рядку словника.

    Тут навмисно сирий стан, а не похідний прапорець «час повторити»: із `id`
    працює кнопка «Забув» просто зі списку (`POST /study/tracks/{id}/review/`),
    а крапку фронтенд малює порівнянням `due_at` із поточним моментом — і вона
    не встигає застаріти дорогою.

    Увага: тут ОБИДВІ доріжки картки, зокрема FORMS у картки без форм — та, яку
    черга ховає. Рахувати з цього масиву «скільки на повторення» не можна, для
    цього є `due_count` списків і лічильники черги.

    `stability` віддається заради сяйва на панелі перегляду картки (ADR-0016):
    воно береться з тих самих шести діапазонів, що й теплова смуга «Прогресу»
    (`STABILITY_BAND_EDGES`). `None` — це стан NEW, у якого величини ще немає;
    підставляти нуль не можна, бо це означало б «тримається менше дня».
    """

    id: int
    kind: ReviewKindEnum
    state: ReviewStateEnum
    due_at: datetime
    stability: float | None

    model_config = ConfigDict(from_attributes=True)


def _links_to_ids(value: Any) -> Any:
    """relationship віддає CardListLinkModel, а назовні їдуть самі id."""
    if isinstance(value, (list, tuple)):
        return [item if isinstance(item, int) else item.list_id for item in value]
    return value


class CardSchema(BaseModel):
    """
    Картка цілком — та сама і в списку словника, і після збереження.

    Полегшеного варіанта немає навмисно: приклади й форми додають до сторінки в
    50 карток близько 4 КБ, а окрема схема «для списку» означала б другий запит
    на кожне відкриття редактора і два типи, які з часом розійдуться.
    """

    id: int
    word: str
    comment: str | None
    forms_drill_enabled: bool
    created_at: datetime
    list_ids: Annotated[list[int], BeforeValidator(_links_to_ids)] = Field(
        validation_alias="list_links"
    )
    senses: list[WordSenseSchema]
    forms: list[WordFormSchema]
    tracks: list[CardTrackSchema] = Field(validation_alias="review_tracks")

    model_config = ConfigDict(from_attributes=True)


class CardPageSchema(BaseModel):
    total: int
    page: int
    per_page: int
    items: list[CardSchema]


class WordListSchema(BaseModel):
    """
    `share_token` заповнений, якщо список зараз поділений.

    Токен їде разом зі списком навмисно: інакше акордеон словника не міг би
    показати іконку «поділено», не смикнувши окремий запит на кожен список.
    Бачить його лише власник — це його ж списки.

    `in_library` — те саме для Бібліотеки, і саме `bool`, а не id публікації:
    рядок списку показує СТАН, а перейти до публікації однаково можна лише через
    `list_id`, який у нього вже є. Знята публікація дає `false` — у рядку
    показується «на витрині», а не «колись публікував».
    """

    id: int
    name: str
    position: int
    card_count: int
    due_count: int
    share_token: str | None = None
    in_library: bool = False


class UnlistedSchema(BaseModel):
    """
    «Без списку» — картки, що не лежать у жодному списку.

    Це не список: `id` тут немає і бути не може, бо це відсутність міток, а не
    мітка. Фронтенд показує його поруч зі списками, а відкриває через
    `?unlisted=true`.
    """

    card_count: int
    due_count: int


class WordListPageSchema(BaseModel):
    items: list[WordListSchema]
    unlisted: UnlistedSchema


class StabilityBandsSchema(BaseModel):
    """
    Розподіл словника за стабільністю доріжки перекладу — теплова смуга.

    Одиниця — слово, а не доріжка: рахується лише переклад, тож сума полів
    дорівнює cards. Діапазони в днях: до 1 · 1–6 · 6–30 · 30–180 · понад 180.
    Межа 6 — та сама, що в означенні «Вивчено».
    """

    new: int
    under_day: int
    days: int
    weeks: int
    months: int
    long: int


class VocabularyStatsSchema(BaseModel):
    """
    Панель «Словник» на екрані прогресу.

    Знаменники тут різні, і це навмисно: cards рахує слова, due_tracks —
    доріжки. Картка з формами дає дві одиниці роботи, тож due_tracks може бути
    більшим за cards. Підпис у інтерфейсі мусить це називати, інакше «608 слів,
    705 на повторення» виглядає помилкою.
    """

    lists: int
    cards: int
    due_tracks: int
    learned: int
    stability_bands: StabilityBandsSchema


# --------------------------------------------------------------------------
# Запис
# --------------------------------------------------------------------------


class SenseExampleWriteSchema(BaseModel):
    id: int | None = None
    text_en: Annotated[str, BeforeValidator(_stripped)] = ""
    text_uk: OptionalText = None

    model_config = ConfigDict(extra="forbid")

    @property
    def is_blank(self) -> bool:
        # Без англійського речення приклад безглуздий, навіть якщо переклад є.
        return is_blank(self.text_en)


class WordSenseWriteSchema(BaseModel):
    id: int | None = None
    part_of_speech: PartOfSpeechEnum | None = None
    translation: OptionalText = Field(default=None, max_length=255)
    transcription: OptionalText = Field(default=None, max_length=100)
    examples: Annotated[
        list[SenseExampleWriteSchema], AfterValidator(_drop_blank)
    ] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")

    @property
    def is_blank(self) -> bool:
        """
        Порожнє, лише якщо не заповнено НІЧОГО — включно з частиною мови.

        Так само рахував старий PWA (`senseNonEmpty`, index.html:656). Строгіший
        критерій «немає перекладу» відкинув би живі дані: у картки "that is why"
        перекладу немає, а транскрипція і два приклади є.
        """
        return (
            self.part_of_speech is None
            and not self.examples
            and is_blank(self.translation, self.transcription)
        )


class WordFormWriteSchema(BaseModel):
    id: int | None = None
    label: OptionalText = Field(default=None, max_length=50)
    value: Annotated[str, BeforeValidator(_stripped)] = Field(
        default="", max_length=100
    )
    transcription: OptionalText = Field(default=None, max_length=100)

    model_config = ConfigDict(extra="forbid")

    @property
    def is_blank(self) -> bool:
        # Мітка без самої форми нічого не тренує.
        return is_blank(self.value)


Senses = Annotated[list[WordSenseWriteSchema], AfterValidator(_drop_blank)]
Forms = Annotated[list[WordFormWriteSchema], AfterValidator(_drop_blank)]


class CardCreateSchema(BaseModel):
    """
    Обов'язкове тут лише слово.

    Порожній `list_ids` означає «без списку», і це нормальний стан: дефолтний
    список — справа фронтенду, сервер про нього не знає й нічого не підставляє.
    """

    word: RequiredText = Field(max_length=MAX_WORD_LENGTH)
    comment: OptionalText = None
    forms_drill_enabled: bool = True
    list_ids: list[int] = Field(default_factory=list)
    senses: Senses = Field(default_factory=list)
    forms: Forms = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class CardUpdateSchema(BaseModel):
    """
    Часткове оновлення: чого немає в тілі, того не чіпаємо.

    Різниця між «поля немає» і «поле порожнє» тут несуча. `senses: []` означає
    «прибрати всі значення», а відсутнє `senses` — «залиш як є». Без цього не
    можна ні очистити значення, ні перейменувати слово, не пересилаючи всю
    картку цілком.
    """

    word: RequiredText | None = Field(default=None, max_length=MAX_WORD_LENGTH)
    comment: OptionalText = None
    forms_drill_enabled: bool | None = None
    list_ids: list[int] | None = None
    senses: Senses | None = None
    forms: Forms | None = None

    model_config = ConfigDict(extra="forbid")


class WordListCreateSchema(BaseModel):
    name: RequiredText = Field(max_length=MAX_LIST_NAME_LENGTH)

    model_config = ConfigDict(extra="forbid")


class WordListUpdateSchema(BaseModel):
    name: RequiredText | None = Field(default=None, max_length=MAX_LIST_NAME_LENGTH)
    position: int | None = Field(default=None, ge=0)

    model_config = ConfigDict(extra="forbid")
