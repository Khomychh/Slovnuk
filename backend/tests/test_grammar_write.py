"""
Тести запису граматики.

Найдорожча помилка тут одна: сплутати «поля немає» з «поле порожнє». За типом
обидва випадки — None, і якщо роут покладеться на значення замість
exclude_unset, то збереження зміненого заголовка тихо викине розділ. Виглядає
це як успішне збереження.

БД для цих перевірок не потрібна.
"""

import pytest

from app.schemas.grammar import (
    GrammarNoteCreateSchema,
    GrammarNoteUpdateSchema,
    NoteCategoryUpdateSchema,
)


class TestCategoryIsAbsentOrNull:
    """`category` відсутнє — «залиш як є»; `null` — «прибери розділ»."""

    def test_absent_category_stays_out_of_the_update(self):
        payload = GrammarNoteUpdateSchema(title="Артиклі")
        assert "category" not in payload.model_dump(exclude_unset=True)

    def test_explicit_null_reaches_the_update(self):
        payload = GrammarNoteUpdateSchema(category=None)
        fields = payload.model_dump(exclude_unset=True)
        assert "category" in fields
        assert fields["category"] is None

    def test_blank_category_means_remove_not_a_category_named_space(self):
        """Розділ на імʼя « » завести не можна — порожній рядок це відсутність."""
        payload = GrammarNoteUpdateSchema(category="   ")
        fields = payload.model_dump(exclude_unset=True)
        assert "category" in fields
        assert fields["category"] is None

    def test_named_category_survives_stripping(self):
        payload = GrammarNoteUpdateSchema(category="  Часи  ")
        assert payload.model_dump(exclude_unset=True)["category"] == "Часи"


class TestBodyIsAbsentOrNull:
    """Те саме розрізнення для тіла: очистити тіло треба вміти."""

    def test_absent_body_stays_out(self):
        payload = GrammarNoteUpdateSchema(title="Артиклі")
        assert "body_markdown" not in payload.model_dump(exclude_unset=True)

    def test_explicit_null_clears_the_body(self):
        fields = GrammarNoteUpdateSchema(body_markdown=None).model_dump(
            exclude_unset=True
        )
        assert fields["body_markdown"] is None


class TestTitle:
    def test_blank_title_is_rejected_on_create(self):
        with pytest.raises(ValueError):
            GrammarNoteCreateSchema(title="   ")

    def test_title_is_stripped(self):
        assert GrammarNoteCreateSchema(title="  Артиклі  ").title == "Артиклі"

    def test_note_without_category_is_valid(self):
        """«Без розділу» — нормальний стан нотатки, а не помилка вводу."""
        note = GrammarNoteCreateSchema(title="Артиклі")
        assert note.category is None


class TestUnknownFieldsAreRejected:
    """extra=forbid, щоб одруківка в імені поля не була тихо проігнорована."""

    def test_note_update_rejects_unknown_field(self):
        with pytest.raises(ValueError):
            GrammarNoteUpdateSchema(categoty="Часи")

    def test_category_update_rejects_unknown_field(self):
        with pytest.raises(ValueError):
            NoteCategoryUpdateSchema(nmae="Часи")

    def test_category_id_is_not_writable_on_a_note(self):
        """Розділ задається назвою. Прийняти ще й id означало б два способи."""
        with pytest.raises(ValueError):
            GrammarNoteUpdateSchema(category_id=3)


class TestPosition:
    def test_negative_position_is_rejected(self):
        with pytest.raises(ValueError):
            NoteCategoryUpdateSchema(position=-1)

    def test_absent_position_stays_out(self):
        payload = NoteCategoryUpdateSchema(name="Часи")
        assert "position" not in payload.model_dump(exclude_unset=True)
