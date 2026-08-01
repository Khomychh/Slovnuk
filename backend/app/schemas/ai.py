"""
Схеми заповнення картки з ШІ.

Головне про цей файл: `AiResultSchema` працює двічі. З неї генерується
JSON-схема, яку ми віддаємо Claude в `output_config.format`, і нею ж
валідується відповідь. Одна модель — одне джерело правди; інакше схема для
моделі й схема відповіді розійшлися б на третій правці.

Поля навмисно повторюють імена з `CardCreateSchema` (`senses[].translation`,
`forms[].value`, …). Це не збіг: фронтенд підставляє пропозицію в чернетку
картки без шару перетворення, а нове поле значення з'являється в обох місцях
само.

Чого тут немає:

* `id` — пропозиції нічого ідентифікувати, вона ніде не зберігається;
* `list_ids` — куди класти картку, вирішує людина (і список за замовчуванням);
* `word` — ШІ не міняє слово ніколи (CONTEXT.md, «Пропозиція»). Він заповнює
  навколо нього або відмовляється.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.database.models import PartOfSpeechEnum
from app.schemas.vocabulary import MAX_WORD_LENGTH


# --------------------------------------------------------------------------
# Запит
# --------------------------------------------------------------------------


class AiProposalRequestSchema(BaseModel):
    """Слово, для якого просимо пропозицію. Більше роут нічого не приймає."""

    word: str = Field(min_length=1, max_length=MAX_WORD_LENGTH)


# --------------------------------------------------------------------------
# Те, що повертає модель
# --------------------------------------------------------------------------


class AiExampleSchema(BaseModel):
    text_en: str = Field(max_length=500)
    text_uk: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(extra="forbid")


class AiSenseSchema(BaseModel):
    part_of_speech: PartOfSpeechEnum | None = None
    translation: str | None = Field(default=None, max_length=255)
    transcription: str | None = Field(default=None, max_length=100)
    examples: list[AiExampleSchema] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class AiFormSchema(BaseModel):
    label: str | None = Field(default=None, max_length=50)
    value: str = Field(max_length=100)
    transcription: str | None = Field(default=None, max_length=100)

    model_config = ConfigDict(extra="forbid")


class AiProposalSchema(BaseModel):
    """
    Пропозиція — те, що ляже у форму, якщо людина погодиться.

    `comment` тут майже завжди `None`, і це задумано: коментар з'являється лише
    там, де є конкретна пастка (фальшивий друг, плутанина з близьким словом,
    реєстр). Інакше поле, задумане як попередження, перетворилося б на шум.
    """

    senses: list[AiSenseSchema] = Field(default_factory=list)
    # Порожній список для правильного слова — нормальна відповідь, а не
    # недоробка: форма за визначенням нестандартна (CONTEXT.md, «Форма»), тож
    # `walked` формою не є і зайвої доріжки повторень не заводить.
    forms: list[AiFormSchema] = Field(default_factory=list)
    comment: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(extra="forbid")


class AiRefusalSchema(BaseModel):
    """Модель каже, що заповнювати нічого: це не англійське слово."""

    reason: str = Field(max_length=300)
    # На що це схоже, якщо схоже. Роут передає це людині, але саме слово в
    # картці не міняє — виправляє його вона сама, і тоді це вже інше слово,
    # тобто нове право на звернення.
    did_you_mean: str | None = Field(default=None, max_length=100)

    model_config = ConfigDict(extra="forbid")


class AiResultSchema(BaseModel):
    """
    Об'єднання двох гілок — рівно те, що дозволено повернути моделі.

    Зроблено двома нульовими полями, а не `anyOf` двох об'єктів: така схема
    тривіальна для будь-якої реалізації структурованого виводу і не залежить
    від того, наскільки добре підтримані дискриміновані об'єднання.

    Ціною цього «рівно одне з двох» гарантується не схемою, а перевіркою в
    сервісі: структурований вивід тримає форму, а не логіку.
    """

    proposal: AiProposalSchema | None = None
    refusal: AiRefusalSchema | None = None

    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------
# Доступ
# --------------------------------------------------------------------------


class AiAccessSchema(BaseModel):
    """Рядок для команди `list` — те, що адміністратору треба бачити."""

    email: str
    granted_at: str
    granted_by_email: str | None
    note: str | None
    transcription_variety: str
    requests_total: int
    words_filled: int
