"""
Схеми граматики.

Розділ у запиті задається НАЗВОЮ, а не id: у старому додатку це поле з
підказкою, куди назва вписується на ходу, і вимагати спершу створити розділ
окремим запитом означало б два звернення на кожен новий ярлик. У відповіді,
навпаки, віддається і id, і назва — фронтенду потрібен id, щоб фільтрувати.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.vocabulary import OptionalText, RequiredText

MAX_NOTE_TITLE_LENGTH = 255
MAX_CATEGORY_NAME_LENGTH = 100


# --------------------------------------------------------------------------
# Читання
# --------------------------------------------------------------------------


class GrammarNoteSchema(BaseModel):
    """
    Нотатка цілком, разом із тілом.

    Полегшеної схеми «для списку» немає з тієї ж причини, що й у CardSchema:
    вона означала б другий запит на кожне відкриття нотатки і два типи, які з
    часом розійдуться. Тіла тут — сотні символів, не мегабайти.

    category_id порожній — це «Без розділу»: не розділ на імʼя «Інше», а його
    відсутність. Нотатка потрапляє туди або одразу, або коли її розділ видалили.
    """

    id: int
    title: str
    body_markdown: str | None
    position: int
    category_id: int | None
    category_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GrammarNotePageSchema(BaseModel):
    total: int
    page: int
    per_page: int
    items: list[GrammarNoteSchema]


class NoteCategorySchema(BaseModel):
    id: int
    name: str
    position: int
    note_count: int


class UncategorizedSchema(BaseModel):
    """
    «Без розділу» — нотатки, яким розділ не вказано.

    id тут немає і бути не може: це відсутність розділу, а не розділ. Фронтенд
    показує групу поруч із розділами, а відкриває через `?uncategorized=true`.
    """

    note_count: int


class NoteCategoryPageSchema(BaseModel):
    """
    Розділи віддаються без пагінації: їх одиниці, і дерево граматики показує всі.

    Порожній розділ у відповіді лишається — він зникає тільки явним DELETE, так
    само як порожній список слів. note_count дає фронтенду право самому
    вирішити, чи його ховати.
    """

    items: list[NoteCategorySchema]
    uncategorized: UncategorizedSchema


# --------------------------------------------------------------------------
# Запис
# --------------------------------------------------------------------------


class GrammarNoteCreateSchema(BaseModel):
    title: RequiredText = Field(max_length=MAX_NOTE_TITLE_LENGTH)
    body_markdown: OptionalText = None
    category: OptionalText = Field(default=None, max_length=MAX_CATEGORY_NAME_LENGTH)

    model_config = ConfigDict(extra="forbid")


class GrammarNoteUpdateSchema(BaseModel):
    """
    Часткове оновлення: чого немає в тілі, того не чіпаємо.

    Різниця між «поля немає» і `category: null` несуча. `null` означає «прибрати
    розділ» — нотатка їде в «Без розділу»; відсутнє поле означає «залиш як є».
    Розрізняє їх `model_dump(exclude_unset=True)` у роуті, а не тип поля: за
    типом обидва випадки — None.
    """

    title: RequiredText | None = Field(default=None, max_length=MAX_NOTE_TITLE_LENGTH)
    body_markdown: OptionalText = None
    category: OptionalText = Field(default=None, max_length=MAX_CATEGORY_NAME_LENGTH)
    position: int | None = Field(default=None, ge=0)

    model_config = ConfigDict(extra="forbid")


class NoteCategoryCreateSchema(BaseModel):
    name: RequiredText = Field(max_length=MAX_CATEGORY_NAME_LENGTH)

    model_config = ConfigDict(extra="forbid")


class NoteCategoryUpdateSchema(BaseModel):
    name: RequiredText | None = Field(default=None, max_length=MAX_CATEGORY_NAME_LENGTH)
    position: int | None = Field(default=None, ge=0)

    model_config = ConfigDict(extra="forbid")
