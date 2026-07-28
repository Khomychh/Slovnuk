"""
Логіка імпорту чужого списку, яку можна перевірити без бази.

Тут вирішується єдине по-справжньому небезпечне питання шерингу: що робити зі
словом, яке в отримувача вже є. Помилка тиха й незворотна — переплутаний бік
копіювання затирає власні переклади користувача, а зайве створення картки
впирається в UNIQUE(user_id, word_normalized) вже посеред транзакції.

Тому звірка винесена чистими функціями і накрита тестами без БД — так само, як
план дітей у services/vocabulary.py.
"""

from dataclasses import dataclass
from typing import Sequence

from app.database.models import (
    CardModel,
    SenseExampleModel,
    WordFormModel,
    WordSenseModel,
    normalize_word,
)
from app.schemas.sharing import ImportMode


MAX_LIST_NAME_LENGTH = 100


@dataclass(frozen=True)
class ImportPlan:
    """
    Що саме зробить імпорт.

    sources — картки з чужого списку, які треба створити заново.
    overwrites — пари (чуже, твоє) для режиму OVERWRITE.
    skipped — скільки слів пропущено, бо вони в отримувача вже є.
    """

    sources: tuple[CardModel, ...]
    overwrites: tuple[tuple[CardModel, CardModel], ...]
    skipped: int

    @property
    def is_empty(self) -> bool:
        """
        Нічого не станеться — ні нової картки, ні перезапису.

        Роут на цьому місці не створює списку: порожній іменований список у
        словнику був би сміттям, яке користувач мусив би прибирати руками.
        """
        return not self.sources and not self.overwrites


def plan_import(
    shared: Sequence[CardModel],
    existing: dict[str, CardModel],
    mode: ImportMode,
) -> ImportPlan:
    """
    Розкласти чужий список на «створити», «перезаписати» і «пропустити».

    `existing` — картки отримувача за нормалізованим словом. Ключ саме
    нормалізований: `Get Up` і `get up` — те саме слово, і база тримає це
    через UNIQUE(user_id, word_normalized).

    У режимі SKIP наявне слово не потрапляє й у новий список. Це свідома
    розбіжність із тим, як імпорт задумувався спершу: список виходить
    неповним, зате чужий шер не може ані змінити твою картку, ані навіть
    домалювати їй мітку. Див. ADR-0005.
    """
    sources: list[CardModel] = []
    overwrites: list[tuple[CardModel, CardModel]] = []
    skipped = 0

    for card in shared:
        target = existing.get(normalize_word(card.word))

        if target is None:
            sources.append(card)
        elif mode is ImportMode.OVERWRITE:
            overwrites.append((card, target))
        else:
            skipped += 1

    return ImportPlan(
        sources=tuple(sources), overwrites=tuple(overwrites), skipped=skipped
    )


def copy_content(source: CardModel, target: CardModel) -> None:
    """
    Перенести вміст слова з чужої картки у власну.

    Копіюється рівно те, що редактор картки показує як вміст слова: коментар,
    значення з прикладами, форми. НЕ копіюються:

    * `forms_drill_enabled` — це особисте налаштування навчання, а не вміст;
    * доріжки і логи — прогрес живе на картці, а не на її тексті, тож
      перезапис вмісту не коштує місяця повторень (ADR-0001, ADR-0003);
    * мітки списків — ними керує роут, а не копіювання.

    Дітей саме перестворюємо, а не звіряємо за id: id чужих значень у нашій
    базі нічого не означають, а «розумне» злиття двох наборів перекладів дає
    дублі на кшталт «йти» і «ходити» в одній картці.
    """
    target.comment = source.comment

    for row in list(target.senses):
        target.senses.remove(row)
    for row in list(target.forms):
        target.forms.remove(row)

    for position, sense in enumerate(source.senses):
        copy = WordSenseModel(
            position=position,
            part_of_speech=sense.part_of_speech,
            translation=sense.translation,
            transcription=sense.transcription,
        )
        for example_position, example in enumerate(sense.examples):
            copy.examples.append(
                SenseExampleModel(
                    position=example_position,
                    text_en=example.text_en,
                    text_uk=example.text_uk,
                )
            )
        target.senses.append(copy)

    for position, form in enumerate(source.forms):
        target.forms.append(
            WordFormModel(
                position=position,
                label=form.label,
                value=form.value,
                transcription=form.transcription,
            )
        )


def new_card(source: CardModel, user_id: int) -> CardModel:
    """
    Власна картка за чужим зразком.

    `forms_drill_enabled` навмисно лишається дефолтним True, а не береться з
    чужої картки: автор міг вимкнути тренування форм собі, і тягти це рішення
    в чужий словник немає підстав.
    """
    card = CardModel(word=source.word, user_id=user_id)
    copy_content(source, card)
    return card


def suggest_name(preferred: str, taken: set[str]) -> str:
    """
    Вільна назва для підказки в перегляді.

    Імпорт із зайнятою назвою відповідає 409, як і POST /lists/ — але впертись
    у помилку після підтвердження неприємно, тож фронтенд отримує вже вільний
    варіант заздалегідь. Порівняння без урахування регістру: find_list_by_name
    шукає так само, інакше підказка «Фразові» при наявних «фразові» призвела б
    рівно до того 409, від якого рятує.
    """
    lowered = {name.strip().lower() for name in taken}
    preferred = preferred.strip()

    if preferred.lower() not in lowered:
        return preferred

    for index in range(2, 1000):
        suffix = f" ({index})"
        base = preferred[: MAX_LIST_NAME_LENGTH - len(suffix)].strip()
        candidate = f"{base}{suffix}"
        if candidate.lower() not in lowered:
            return candidate

    return preferred
