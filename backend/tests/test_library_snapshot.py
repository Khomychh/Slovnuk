"""
Тести знімка публікації — обидва переходи, туди й назад.

Найдорожча помилка тут тиха: втратити поле по дорозі. Людина візьме список і
дізнається, що в ньому немає транскрипцій, лише через тиждень навчання — коли
знімок уже роздано сотні разів, а провина виглядає як «автор не заповнив».

Тому головний тест тут — на **круговий обіг**: картка → знімок → картка мусить
дати те саме до останнього поля. Він ловить утрату навіть тоді, коли структура
картки зміниться, а ці тести ніхто не оновить.

Усе без бази: обидва переходи — чисті функції над моделями в пам'яті.
"""

import pytest

from app.database.models import (
    CardModel,
    PartOfSpeechEnum,
    PublicationCardModel,
    SenseExampleModel,
    WordFormModel,
    WordSenseModel,
)
from app.services.library import (
    card_from_snapshot,
    plan_take,
    snapshot_rows,
)


def rich_card() -> CardModel:
    """
    Картка, у якій заповнено все, що взагалі можна заповнити.

    Спеціально «run» із двома значеннями різних частин мови: саме на ньому
    ламається наївне злиття значень, і саме він лежить в акаунті для перевірок
    інтерфейсу.
    """
    card = CardModel(word="run", comment="дуже вживане")

    verb = WordSenseModel(
        position=0,
        part_of_speech=PartOfSpeechEnum.VERB,
        translation="бігти",
        transcription="rʌn",
    )
    verb.examples.append(
        SenseExampleModel(position=0, text_en="I run every morning.", text_uk="Я бігаю щоранку.")
    )
    # Приклад без перекладу — законний стан, і знімок мусить його зберегти саме
    # порожнім, а не підставляти англійський текст.
    verb.examples.append(SenseExampleModel(position=1, text_en="Run!", text_uk=None))
    card.senses.append(verb)

    noun = WordSenseModel(
        position=1,
        part_of_speech=PartOfSpeechEnum.NOUN,
        translation="забіг",
        transcription=None,
    )
    card.senses.append(noun)

    card.forms.append(
        WordFormModel(position=0, label="Past", value="ran", transcription="ræn")
    )
    # Форма без мітки й без транскрипції — теж законна.
    card.forms.append(WordFormModel(position=1, label=None, value="running", transcription=None))
    return card


def as_snapshot_row(card: CardModel) -> PublicationCardModel:
    """Один рядок знімка з однієї картки — те, що зробить snapshot_rows."""
    return snapshot_rows([card])[0]


class TestSnapshotKeepsEverything:
    def test_round_trip_preserves_every_field(self):
        """
        Картка → знімок → картка. Найважливіший тест у файлі.

        Порівнюється не «схоже», а рівність по всіх полях вмісту. Якщо в картці
        колись з'явиться нове поле і його забудуть у знімку, цей тест почервоніє
        без жодного редагування.
        """
        source = rich_card()
        restored = card_from_snapshot(as_snapshot_row(source), user_id=7)

        assert restored.word == source.word
        assert restored.comment == source.comment
        assert restored.user_id == 7

        assert len(restored.senses) == len(source.senses)
        for got, want in zip(restored.senses, source.senses):
            assert got.part_of_speech == want.part_of_speech
            assert got.translation == want.translation
            assert got.transcription == want.transcription
            assert len(got.examples) == len(want.examples)
            for got_example, want_example in zip(got.examples, want.examples):
                assert got_example.text_en == want_example.text_en
                assert got_example.text_uk == want_example.text_uk

        assert len(restored.forms) == len(source.forms)
        for got, want in zip(restored.forms, source.forms):
            assert got.label == want.label
            assert got.value == want.value
            assert got.transcription == want.transcription

    def test_part_of_speech_survives_as_enum_not_string(self):
        """
        У JSONB частина мови лежить рядком, а назад мусить прийти enum.

        Без цього картка доїхала б до бази з `part_of_speech="v"` замість
        PartOfSpeechEnum.VERB — і впала б уже на вставці, посеред взяття списку
        на 540 слів.
        """
        row = as_snapshot_row(rich_card())
        assert row.content["senses"][0]["part_of_speech"] == "v"

        restored = card_from_snapshot(row, user_id=1)
        assert restored.senses[0].part_of_speech is PartOfSpeechEnum.VERB

    def test_content_is_json_safe(self):
        """
        У `content` не має бути жодного значення, якого не буває в JSON.

        Enum, datetime чи модель, що заїхали туди об'єктом, asyncpg відкине вже
        при вставці — тобто на найдорожчому кроці. Перевіряється рекурсивно, бо
        вкладеність тут на три рівні: senses → examples.
        """
        def assert_json_safe(value, path="content"):
            if isinstance(value, dict):
                for key, item in value.items():
                    assert isinstance(key, str), f"{path}: ключ не рядок — {key!r}"
                    assert_json_safe(item, f"{path}.{key}")
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    assert_json_safe(item, f"{path}[{index}]")
            else:
                assert value is None or isinstance(
                    value, (str, int, float, bool)
                ), f"{path}: {type(value).__name__} не переживе JSONB — {value!r}"

        assert_json_safe(as_snapshot_row(rich_card()).content)

    def test_empty_card_survives(self):
        """
        Картка без значень і без форм — законний стан словника.

        Знімок не має права бути суворішим за словник: інакше публікація списку,
        куди людина накидала слів «розберусь потім», падала б цілком.
        """
        row = as_snapshot_row(CardModel(word="ubiquitous"))
        assert row.content == {"senses": [], "forms": []}

        restored = card_from_snapshot(row, user_id=1)
        assert restored.word == "ubiquitous"
        assert restored.senses == []
        assert restored.forms == []

    def test_missing_content_is_survivable(self):
        """
        Порожній `content` не має валити взяття.

        Такого рядка знімка не породжує наш код — але він може приїхати з
        міграції даних чи з ручної правки, а падати на всьому списку через одну
        каліку неправильно.
        """
        restored = card_from_snapshot(
            PublicationCardModel(word="go", word_normalized="go", content={}), user_id=1
        )
        assert restored.word == "go"
        assert restored.senses == []

    def test_forms_drill_is_not_carried_over(self):
        """
        Тренування форм — налаштування навчання, а не вміст.

        Автор міг вимкнути його собі; тягти це рішення в чужий словник немає
        підстав. У знімку його немає взагалі.

        Перевіряється саме «не встановлено», а не `is True`: `default=True` у
        mapped_column — це дефолт КОЛОНКИ, який SQLAlchemy підставляє при INSERT,
        а не дефолт атрибута. На незбереженому об'єкті поле лишається None, і
        True воно стане в базі. Твердження `is None` тут сильніше: воно ловить
        саме те, що ми поля не торкались, — тоді як `is True` пройшло б і в разі,
        якби ми виставили його вручну.
        """
        source = rich_card()
        source.forms_drill_enabled = False

        row = as_snapshot_row(source)
        assert "forms_drill_enabled" not in row.content

        restored = card_from_snapshot(row, user_id=1)
        assert restored.forms_drill_enabled is None, (
            "картка з знімка не має права нести чуже налаштування навчання — "
            "ні False автора, ні виставлене нами True"
        )


class TestSnapshotOrder:
    def test_position_follows_the_given_order(self):
        """
        Порядок фіксується в момент зняття й далі не залежить ні від чого.

        Сортування словника автора — його особиста преференція; читач публікації
        мусить бачити стабільний порядок, інакше друга сторінка перекривалася б
        із першою.
        """
        rows = snapshot_rows(
            [CardModel(word=word) for word in ("run", "go", "take")]
        )
        assert [(row.position, row.word) for row in rows] == [
            (0, "run"),
            (1, "go"),
            (2, "take"),
        ]

    def test_word_is_normalized_for_comparison(self):
        """
        `word_normalized` у знімку той самий, що й у словнику.

        На ньому тримається і звірка «чого в мене вже немає», і
        UNIQUE(publication_id, word_normalized). Розійшовшись зі словником, він
        зробив би `already_have` брехливим саме там, де регістр не збігається.
        """
        row = as_snapshot_row(CardModel(word="  Get Up  "))
        assert row.word_normalized == "get up"
        # Саме слово лишається як його написав автор: у публікації показується
        # його написання, а не наша нормалізація.
        assert row.word == "Get Up"


class TestPlanTake:
    def _existing(self, *words: str) -> dict[str, CardModel]:
        cards = [CardModel(word=word) for word in words]
        return {card.word_normalized: card for card in cards}

    def test_new_words_become_sources(self):
        plan = plan_take(snapshot_rows([CardModel(word="run")]), self._existing())
        assert [row.word for row in plan.sources] == ["run"]
        assert plan.skipped_words == ()

    def test_existing_word_is_skipped_and_named(self):
        """
        Пропущене слово не просто рахується — воно називається.

        Список виходить неповним за визначенням (ADR-0005), і неповнота, про яку
        не сказали, читається як загублені слова.
        """
        snapshot = snapshot_rows(
            [CardModel(word=word) for word in ("run", "go", "take")]
        )
        plan = plan_take(snapshot, self._existing("go"))

        assert [row.word for row in plan.sources] == ["run", "take"]
        assert plan.skipped_words == ("go",)
        assert plan.skipped == 1

    def test_skipped_word_uses_the_source_spelling(self):
        """
        У пропущених стоїть написання ДЖЕРЕЛА, не твоє.

        Людина щойно гортала чужий список, де було «Get Up». Побачивши в звіті
        власне «get up», вона не зіставить рядок із тим, що бачила.
        """
        plan = plan_take(
            snapshot_rows([CardModel(word="Get Up")]), self._existing("get up")
        )
        assert plan.skipped_words == ("Get Up",)

    def test_overwrites_are_impossible(self):
        """
        Режиму «перезаписати мої картки» в Бібліотеці не існує.

        У шері він доречний — там ти знаєш, від кого береш. Тут на іншому кінці
        незнайомець, а ціна помилки — роки власних перекладів.
        """
        plan = plan_take(
            snapshot_rows([CardModel(word="run")]), self._existing("run")
        )
        assert plan.overwrites == ()
        assert plan.sources == ()
        assert plan.is_empty

    def test_everything_already_present_is_empty_plan(self):
        """
        Порожній план — сигнал роуту не створювати списку.

        Порожній іменований список у словнику був би сміттям, яке користувач
        мусив би прибирати руками.
        """
        snapshot = snapshot_rows([CardModel(word=w) for w in ("run", "go")])
        plan = plan_take(snapshot, self._existing("run", "go"))

        assert plan.is_empty
        assert plan.skipped_words == ("run", "go")


# Класу TestVisibleRating тут більше немає: поріг видимості рейтингу живе єдиним
# SQL-виразом (`cruds/library._VISIBLE_RATING`), бо витрина сортує за рейтингом у
# базі. Його перевіряють контрактні тести Бібліотеки — пітонівська копія правила
# була б мертвим кодом, а тести на неї давали б хибну впевненість, що показане
# число накрито.
