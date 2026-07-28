"""
Тести звірки дітей картки та відсіву порожнього вводу.

Саме тут найдорожча помилка в словнику: картка приходить з фронтенду цілком, і
переплутаний бік порівняння тихо стирає приклади користувача, а забута перевірка
належності дозволяє перетягти до себе значення з чужої картки. Обидві помилки
виглядають як успішне збереження.

БД для цих перевірок не потрібна — логіка навмисно винесена чистими функціями.
"""

import pytest

from app.schemas.vocabulary import (
    CardCreateSchema,
    CardUpdateSchema,
    SenseExampleWriteSchema,
    WordFormWriteSchema,
    WordSenseWriteSchema,
)
from app.services.vocabulary import UnknownChildIdError, is_blank, plan_children


class Row:
    """Заглушка наявного рядка: звірці потрібен лише id."""

    def __init__(self, id: int):
        self.id = id

    def __repr__(self):
        return f"Row({self.id})"


class Item:
    """Заглушка елемента payload."""

    def __init__(self, id: int | None = None):
        self.id = id


class TestPlanChildren:
    def test_item_without_id_is_created(self):
        plan = plan_children([], [Item(), Item()])

        assert [op.existing for op in plan.ops] == [None, None]
        assert plan.orphans == ()

    def test_item_with_known_id_is_updated(self):
        row = Row(7)
        plan = plan_children([row], [Item(7)])

        assert [op.existing for op in plan.ops] == [row]
        assert plan.orphans == ()

    def test_row_missing_from_payload_is_deleted(self):
        kept, dropped = Row(1), Row(2)
        plan = plan_children([kept, dropped], [Item(1)])

        assert plan.orphans == (dropped,)
        assert [op.existing for op in plan.ops] == [kept]

    def test_empty_payload_deletes_everything(self):
        """Прибрати останнє значення картки має бути можливо."""
        rows = [Row(1), Row(2)]
        plan = plan_children(rows, [])

        assert plan.ops == ()
        assert plan.orphans == tuple(rows)

    def test_foreign_id_is_rejected(self):
        """
        id чужої дитини не створює новий рядок і не оновлює нічий.

        Мовчазне створення приховало б помилку клієнта, мовчазне оновлення дало
        б спосіб правити чужі дані.
        """
        with pytest.raises(UnknownChildIdError) as error:
            plan_children([Row(1)], [Item(1), Item(999)])

        assert error.value.unknown_ids == [999]

    def test_position_follows_payload_order(self):
        """Порядок значень у картці задає масив, а не id і не created_at."""
        first, second = Row(10), Row(20)
        plan = plan_children([first, second], [Item(20), Item(None), Item(10)])

        assert [op.position for op in plan.ops] == [0, 1, 2]
        assert [op.existing for op in plan.ops] == [second, None, first]

    def test_update_and_delete_do_not_overlap(self):
        """Рядок, згаданий у payload, не має потрапити ще й у сироти."""
        rows = [Row(1), Row(2), Row(3)]
        plan = plan_children(rows, [Item(2)])

        updated = {op.existing for op in plan.ops if op.existing is not None}
        assert updated.isdisjoint(set(plan.orphans))
        assert plan.orphans == (rows[0], rows[2])


class TestIsBlank:
    def test_whitespace_counts_as_blank(self):
        assert is_blank("  ", "\n", None)

    def test_any_filled_value_wins(self):
        assert not is_blank(None, "", "щось")


class TestBlankChildrenAreDropped:
    def test_blank_sense_never_reaches_the_database(self):
        card = CardCreateSchema(
            word="talk",
            senses=[
                WordSenseWriteSchema(translation="розмовляти"),
                WordSenseWriteSchema(translation="   ", gloss="", transcription=None),
            ],
        )

        assert [sense.translation for sense in card.senses] == ["розмовляти"]

    def test_sense_without_translation_survives_on_transcription_alone(self):
        """
        Картка "that is why" зі старого PWA: перекладу немає, є транскрипція і
        приклади. Строгіший критерій відкинув би живі дані.
        """
        card = CardCreateSchema(
            word="that is why",
            senses=[
                WordSenseWriteSchema(
                    transcription="/ðæt ɪz waɪ/",
                    examples=[SenseExampleWriteSchema(text_en="That is why I left.")],
                )
            ],
        )

        assert len(card.senses) == 1

    def test_part_of_speech_alone_keeps_the_sense(self):
        """Так само рахував senseNonEmpty у старому PWA (index.html:656)."""
        card = CardCreateSchema(
            word="run", senses=[WordSenseWriteSchema(part_of_speech="v")]
        )

        assert len(card.senses) == 1

    def test_example_without_english_is_dropped(self):
        card = CardCreateSchema(
            word="talk",
            senses=[
                WordSenseWriteSchema(
                    translation="розмовляти",
                    examples=[
                        SenseExampleWriteSchema(text_en="Let us talk.", text_uk="Поговорімо."),
                        SenseExampleWriteSchema(text_en="  ", text_uk="Переклад без речення"),
                    ],
                )
            ],
        )

        assert [item.text_en for item in card.senses[0].examples] == ["Let us talk."]

    def test_form_without_value_is_dropped(self):
        card = CardCreateSchema(
            word="go",
            forms=[
                WordFormWriteSchema(label="Past", value="went"),
                WordFormWriteSchema(label="Gerund", value="  "),
            ],
        )

        assert [form.value for form in card.forms] == ["went"]

    def test_whitespace_only_word_is_rejected(self):
        with pytest.raises(ValueError):
            CardCreateSchema(word="   ")


class TestPartialUpdate:
    def test_missing_field_is_distinguishable_from_empty_one(self):
        """
        Несуча різниця: `senses: []` очищає значення, а відсутнє `senses` лишає
        їх як є. Без неї не можна ні очистити значення, ні перейменувати слово,
        не пересилаючи всю картку.
        """
        untouched = CardUpdateSchema(word="talk")
        cleared = CardUpdateSchema(senses=[])

        assert "senses" not in untouched.model_fields_set
        assert untouched.senses is None

        assert "senses" in cleared.model_fields_set
        assert cleared.senses == []

    def test_blank_comment_becomes_none(self):
        assert CardUpdateSchema(comment="   ").comment is None
