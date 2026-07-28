"""
Схеми шерингу.

Головна відмінність від схем словника: тут немає жодного `id`. Картка в
перегляді чужого списку — це вміст, а не рядок, на який можна послатися:
віддавати назовні id чужих значень і форм означало б дати клієнту
ідентифікатори, з якими він однаково нічого не може зробити.
"""

import enum

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.database.models import PartOfSpeechEnum
from app.schemas.vocabulary import MAX_LIST_NAME_LENGTH, RequiredText


class ImportMode(str, enum.Enum):
    """
    Що робити зі словом, яке в отримувача вже є.

    SKIP — не чіпати картку і не додавати її в новий список. Список виходить
    неповним, і це нормально: імпортується лише те, чого в тебе не було.

    OVERWRITE — замінити вміст картки вмістом із шеру (значення, приклади,
    форми, коментар) і додати її в новий список. Прогрес повторень при цьому
    не скидається: доріжки живуть на картці, а не на її тексті.

    У базі не зберігається — це параметр однієї операції.
    """

    SKIP = "skip"
    OVERWRITE = "overwrite"


# --------------------------------------------------------------------------
# Власник
# --------------------------------------------------------------------------


class ShareSchema(BaseModel):
    """Посилання очима власника. Токен показується лише йому."""

    token: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# Отримувач
# --------------------------------------------------------------------------


class SharedExampleSchema(BaseModel):
    text_en: str
    text_uk: str | None

    model_config = ConfigDict(from_attributes=True)


class SharedSenseSchema(BaseModel):
    part_of_speech: PartOfSpeechEnum | None
    translation: str | None
    transcription: str | None
    examples: list[SharedExampleSchema]

    model_config = ConfigDict(from_attributes=True)


class SharedFormSchema(BaseModel):
    label: str | None
    value: str
    transcription: str | None

    model_config = ConfigDict(from_attributes=True)


class SharedCardSchema(BaseModel):
    """
    Картка з чужого списку.

    `already_have` рахується проти твого словника за нормалізованим словом і
    означає рівно те, що станеться при імпорті: у режимі skip таку картку буде
    пропущено, у режимі overwrite — перезаписано твою.
    """

    word: str
    comment: str | None
    senses: list[SharedSenseSchema]
    forms: list[SharedFormSchema]
    already_have: bool

    model_config = ConfigDict(from_attributes=True)


class SharedCardPageSchema(BaseModel):
    total: int
    page: int
    per_page: int
    items: list[SharedCardSchema]


class SharePreviewSchema(BaseModel):
    """
    Що видно до імпорту.

    `new_cards` — скільки карток справді з'явиться в режимі skip. Саме це
    число, а не `total_cards`, чесно описує наслідок кнопки: у списку з 50
    слів, 12 із яких у тебе вже є, додасться 38.

    `owner_name` порожній, якщо автор не заповнив ім'я. Email не віддається
    ніколи: посилання може ходити де завгодно.
    """

    list_name: str
    owner_name: str | None
    total_cards: int
    new_cards: int
    suggested_name: str


class ShareImportSchema(BaseModel):
    """
    Назву задає отримувач, а не автор: у нього свій словник і свої звички
    називати списки. Зайнята назва — 409, як і при звичайному створенні списку.
    """

    name: RequiredText = Field(max_length=MAX_LIST_NAME_LENGTH)
    mode: ImportMode = ImportMode.SKIP

    model_config = ConfigDict(extra="forbid")


class ShareImportResultSchema(BaseModel):
    """
    Звіт про імпорт.

    `list_id` порожній, коли списку не створювали — так буває, якщо в режимі
    skip жодного нового слова не знайшлось. Порожній іменований список у
    словнику був би сміттям, яке користувач мусив би прибирати руками.
    """

    list_id: int | None
    name: str
    created: int
    overwritten: int
    skipped: int
