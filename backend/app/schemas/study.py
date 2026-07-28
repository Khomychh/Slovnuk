from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.database.models import (
    ReviewKindEnum,
    ReviewStateEnum,
    StudyDirectionEnum,
    ThemeEnum,
    TtsAccentEnum,
)

# Значення, приклади й форми належать словнику — і в черзі показуються ті самі.
# Друге визначення тих самих полів рано чи пізно розійшлося б із першим.
from app.schemas.vocabulary import (  # noqa: F401  (реекспорт для сумісності)
    SenseExampleSchema,
    WordFormSchema,
    WordSenseSchema,
)


class TrackReviewRequestSchema(BaseModel):
    rating: int = Field(ge=1, le=4, description="1=Не згадав, 2=Важко, 3=Добре, 4=Легко")
    review_duration: int | None = Field(
        default=None, ge=0, description="Мілісекунди від показу картки до оцінки"
    )


class TrackReviewResponseSchema(BaseModel):
    # validation_alias, бо в моделі колонка зветься id. Без нього
    # model_validate(track) падає з «Field required» — тобто 500 на успішному
    # шляху.
    track_id: int = Field(validation_alias="id")
    kind: ReviewKindEnum
    state: ReviewStateEnum
    due_at: datetime
    stability: float | None
    difficulty: float | None

    model_config = ConfigDict(from_attributes=True)


# --- черга ---


class QueueCardSchema(BaseModel):
    """
    Картка цілком: форми віддаються завжди, навіть коли зараз показується
    доріжка перекладу — у старому додатку вони теж були видні на звороті.
    """

    id: int
    word: str
    comment: str | None
    forms_drill_enabled: bool
    senses: list[WordSenseSchema]
    forms: list[WordFormSchema]

    model_config = ConfigDict(from_attributes=True)


class QueueItemSchema(BaseModel):
    track_id: int = Field(validation_alias="id")
    kind: ReviewKindEnum
    state: ReviewStateEnum
    due_at: datetime
    card: QueueCardSchema

    model_config = ConfigDict(from_attributes=True)


class QueueResponseSchema(BaseModel):
    """
    Лічильники стосуються всієї вибірки, а не поточної порції: екран «N карток
    на повторення» має показувати все, що чекає, навіть коли items обрізані
    лімітом.
    """

    due_count: int
    new_count: int
    items: list[QueueItemSchema]


# --- день навчання ---


class StudyDayResponseSchema(BaseModel):
    day: date
    new_goal: int
    review_goal: int
    new_added: int
    reviews_done: int
    is_goal_met: bool


class StudyDaySchema(BaseModel):
    """
    Один день у календарі прогресу.

    Цілі — знімок, що діяв саме того дня, а не поточні: підвищення планки не
    має переписувати минуле. Кількості, навпаки, рахуються щоразу заново з
    незмінних даних (cards.created_at, review_logs) — у study_days їх немає і
    дублювати їх туди не треба.
    """

    day: date
    new_goal: int
    review_goal: int
    new_count: int
    review_count: int
    is_goal_met: bool


class StudyDaysResponseSchema(BaseModel):
    """
    Дні лише з активністю, старіші зверху.

    Порожніх днів у відповіді немає: сітку місяця малює фронтенд, а тягнути
    тридцять нулів, щоб намалювати тридцять сірих клітинок, немає сенсу.
    """

    items: list[StudyDaySchema]


# --- налаштування ---


class StudySettingsResponseSchema(BaseModel):
    theme: ThemeEnum
    study_direction: StudyDirectionEnum
    tts_enabled: bool
    tts_autoplay: bool
    tts_accent: TtsAccentEnum
    tts_slow: bool
    daily_new_goal: int
    daily_review_goal: int
    desired_retention: float
    timezone: str
    # Самі ваги назовні не віддаємо: 21 число фронтенду ні про що не говорить,
    # а показати «параметри підібрано чи ще ні» треба.
    fsrs_parameters_version: int | None
    has_personal_parameters: bool = Field(validation_alias="fsrs_parameters")

    model_config = ConfigDict(from_attributes=True)

    @field_validator("has_personal_parameters", mode="before")
    @classmethod
    def _parameters_to_flag(cls, value: list | None) -> bool:
        return bool(value)


class StudySettingsUpdateSchema(BaseModel):
    """
    fsrs_parameters тут немає навмисно, і extra="forbid" робить спробу їх
    передати помилкою 422, а не тихим ігноруванням. Ваги пише лише скрипт
    оптимізатора з машини розробника (ADR-0002); запис через API дав би
    можливість зламати собі планування назавжди одним PATCH.
    """

    theme: ThemeEnum | None = None
    study_direction: StudyDirectionEnum | None = None
    tts_enabled: bool | None = None
    tts_autoplay: bool | None = None
    tts_accent: TtsAccentEnum | None = None
    tts_slow: bool | None = None
    daily_new_goal: int | None = Field(default=None, ge=0, le=1000)
    daily_review_goal: int | None = Field(default=None, ge=0, le=1000)
    # Межі тримає схема, бо fsrs.Scheduler їх не перевіряє взагалі: він валідує
    # лише parameters, а desired_retention бере як є.
    desired_retention: float | None = Field(default=None, ge=0.7, le=0.99)
    timezone: str | None = Field(default=None, max_length=64)

    model_config = ConfigDict(extra="forbid")

    @field_validator("timezone")
    @classmethod
    def _validate_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise PydanticCustomError(
                "timezone_unknown",
                "Unknown IANA timezone name.",
            )
        return value
