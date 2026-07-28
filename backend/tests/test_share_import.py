"""
Тести імпорту чужого списку.

Найдорожча помилка тут — перезаписати власні переклади користувача там, де він
просив їх не чіпати. Друга за ціною — створити картку на слово, яке в нього вже
є: така спроба впирається в UNIQUE(user_id, word_normalized) вже посеред
транзакції, тобто імпорт падає на 300-й картці з 540.

Обидві перевіряються без бази: plan_import і copy_content — чисті функції над
моделями в пам'яті.
"""

import pytest

from app.database.models import (
    CardModel,
    SenseExampleModel,
    WordFormModel,
    WordSenseModel,
)
from app.schemas.sharing import ImportMode
from app.services.sharing import (
    MAX_LIST_NAME_LENGTH,
    copy_content,
    new_card,
    plan_import,
    suggest_name,
)


def make_card(word: str, *, comment=None, translations=(), forms=(), examples=()):
    """Картка в пам'яті. user_id не потрібен — до бази вона не доїде."""
    card = CardModel(word=word, comment=comment)
    for position, translation in enumerate(translations):
        sense = WordSenseModel(position=position, translation=translation)
        for example_position, text in enumerate(examples):
            sense.examples.append(
                SenseExampleModel(position=example_position, text_en=text)
            )
        card.senses.append(sense)
    for position, value in enumerate(forms):
        card.forms.append(WordFormModel(position=position, label="Past", value=value))
    return card


def by_word(*cards: CardModel) -> dict[str, CardModel]:
    return {card.word_normalized: card for card in cards}


class TestPlanImportSkipsWhatYouAlreadyHave:
    """
    Режим за замовчуванням: наявне слово не чіпається й у новий список не йде.

    Це свідома розбіжність із першим задумом («наявна картка отримує ще одну
    мітку»), через яку імпортований список виходить неповним — ADR-0005.
    """

    def test_new_words_become_cards(self):
        shared = [make_card("get up"), make_card("give in")]

        plan = plan_import(shared, {}, ImportMode.SKIP)

        assert [card.word for card in plan.sources] == ["get up", "give in"]
        assert plan.overwrites == ()
        assert plan.skipped == 0

    def test_existing_word_is_skipped_entirely(self):
        mine = make_card("get up", translations=["вставати"])
        shared = [make_card("get up"), make_card("give in")]

        plan = plan_import(shared, by_word(mine), ImportMode.SKIP)

        assert [card.word for card in plan.sources] == ["give in"]
        assert plan.overwrites == ()
        assert plan.skipped == 1

    def test_match_ignores_case_and_spaces(self):
        """
        Звірка йде за нормалізованим словом — тим самим ключем, яким база тримає
        унікальність. Інакше «Get Up» проскочило б повз перевірку і впало б на
        UNIQUE вже під час запису.
        """
        mine = make_card("get up")
        shared = [make_card("  Get Up  ")]

        plan = plan_import(shared, by_word(mine), ImportMode.SKIP)

        assert plan.sources == ()
        assert plan.skipped == 1

    def test_nothing_to_do_is_visible_to_the_route(self):
        """Повторний імпорт того самого шеру: списку створювати не треба."""
        mine = make_card("get up")
        plan = plan_import([make_card("get up")], by_word(mine), ImportMode.SKIP)

        assert plan.is_empty
        assert plan.skipped == 1

    def test_import_of_new_words_is_not_empty(self):
        plan = plan_import([make_card("get up")], {}, ImportMode.SKIP)
        assert not plan.is_empty


class TestPlanImportOverwrite:
    """Явний вибір користувача: «хай у мене буде так, як у автора»."""

    def test_existing_word_is_paired_with_its_source(self):
        mine = make_card("get up", translations=["вставати"])
        shared_card = make_card("get up", translations=["підніматися"])

        plan = plan_import([shared_card], by_word(mine), ImportMode.OVERWRITE)

        assert plan.sources == ()
        assert plan.overwrites == ((shared_card, mine),)
        assert plan.skipped == 0

    def test_new_words_still_become_cards(self):
        mine = make_card("get up")
        shared = [make_card("get up"), make_card("give in")]

        plan = plan_import(shared, by_word(mine), ImportMode.OVERWRITE)

        assert [card.word for card in plan.sources] == ["give in"]
        assert len(plan.overwrites) == 1


class TestCopyContent:
    """
    Що саме переїжджає в чужу картку.

    Прогрес не переїжджає ніколи: доріжки живуть на картці, а не на її тексті,
    і чужий список не має коштувати місяця повторень.
    """

    def test_replaces_senses_instead_of_merging_them(self):
        """
        Значення саме заміняються. «Розумне» злиття двох наборів перекладів дало
        б «вставати» і «підніматися» як два значення однієї картки — тобто тихо
        роздувало б словник, який користувач веде руками.
        """
        mine = make_card("get up", translations=["вставати"])
        source = make_card("get up", translations=["підніматися"], examples=["Get up!"])

        copy_content(source, mine)

        assert [sense.translation for sense in mine.senses] == ["підніматися"]
        assert [example.text_en for example in mine.senses[0].examples] == ["Get up!"]

    def test_forms_are_replaced_too(self):
        mine = make_card("go", forms=["went"])
        source = make_card("go", forms=["went", "gone"])

        copy_content(source, mine)

        assert [form.value for form in mine.forms] == ["went", "gone"]

    def test_comment_is_replaced_including_with_nothing(self):
        """Коментар — частина вмісту слова, і порожній коментар автора теж."""
        mine = make_card("get up", comment="казав шеф на планірці")
        source = make_card("get up")

        copy_content(source, mine)

        assert mine.comment is None

    def test_copies_are_new_rows_not_shared_ones(self):
        """
        Дітей перестворюємо. Якби ми приліпили сам об'єкт автора, SQLAlchemy
        перевісив би його на нашу картку — тобто імпорт викрав би значення з
        чужого словника.
        """
        source = make_card("get up", translations=["підніматися"], examples=["Get up!"])
        mine = make_card("get up")

        copy_content(source, mine)

        assert mine.senses[0] is not source.senses[0]
        assert mine.senses[0].examples[0] is not source.senses[0].examples[0]
        assert len(source.senses[0].examples) == 1

    def test_positions_are_renumbered_from_zero(self):
        source = make_card("get up", translations=["а", "б"])
        source.senses[0].position = 7
        source.senses[1].position = 9
        mine = make_card("get up")

        copy_content(source, mine)

        assert [sense.position for sense in mine.senses] == [0, 1]


class TestNewCard:
    def test_word_and_normalized_key_come_from_the_source(self):
        card = new_card(make_card("  Get Up  "), user_id=3)

        assert card.word == "Get Up"
        assert card.word_normalized == "get up"
        assert card.user_id == 3

    def test_forms_drill_stays_at_the_default(self):
        """
        Автор міг вимкнути тренування форм собі; тягти це рішення в чужий
        словник немає підстав.
        """
        source = make_card("go", forms=["went"])
        source.forms_drill_enabled = False

        card = new_card(source, user_id=3)

        assert card.forms_drill_enabled is not False


class TestSuggestName:
    """Підказка назви в перегляді — щоб імпорт не впирався в 409 після підтвердження."""

    def test_free_name_is_offered_as_is(self):
        assert suggest_name("Фразові дієслова", {"Загальний"}) == "Фразові дієслова"

    def test_taken_name_gets_a_number(self):
        assert suggest_name("Загальний", {"Загальний"}) == "Загальний (2)"

    def test_numbering_walks_past_taken_variants(self):
        taken = {"Загальний", "Загальний (2)", "Загальний (3)"}
        assert suggest_name("Загальний", taken) == "Загальний (4)"

    def test_comparison_ignores_case(self):
        """find_list_by_name шукає без урахування регістру — підказка мусить теж."""
        assert suggest_name("Загальний", {"загальний"}) == "Загальний (2)"

    def test_suffix_never_pushes_the_name_over_the_column_limit(self):
        long_name = "с" * MAX_LIST_NAME_LENGTH
        suggested = suggest_name(long_name, {long_name})

        assert len(suggested) <= MAX_LIST_NAME_LENGTH
        assert suggested.endswith(" (2)")
