"""
Логіка збереження картки, яку можна перевірити без бази.

Картка приходить з фронтенду цілком — слово, значення, приклади, форми, — і
сервер має перетворити цей payload на три дії над наявними рядками: оновити,
створити, видалити. Помилка тут тиха й дорога: переплутаний бік порівняння
знищує приклади користувача, а забута перевірка належності дозволяє перетягти
до себе значення з чужої картки.

Тому звірка винесена сюди чистою функцією і накрита тестами без БД — так само,
як межі доби в services/study_day.py.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable, Protocol, Sequence

from app.database.models import (
    CardListLinkModel,
    CardModel,
    ReviewKindEnum,
    ReviewStateEnum,
    ReviewTrackModel,
    SenseExampleModel,
    WordFormModel,
    WordSenseModel,
)


class HasId(Protocol):
    """Наявний рядок у базі. Його id завжди є."""

    id: int


class HasOptionalId(Protocol):
    """
    Елемент payload. id відсутній (None) означає «створити новий рядок».

    Саме None, а не 0 чи -1: клієнт, який будує форму, не має вигадувати
    тимчасові ідентифікатори.
    """

    id: int | None


class UnknownChildIdError(LookupError):
    """
    payload посилається на id, якого серед дітей цього батька немає.

    Це не «нічого страшного, створимо новий»: такий id належить або іншій
    картці того самого користувача, або взагалі чужій. Мовчазне створення
    приховало б помилку клієнта, а мовчазне оновлення дало б спосіб правити
    чужі дані. Роут перетворює це на 422.
    """

    def __init__(self, unknown_ids: Iterable[int]):
        self.unknown_ids = sorted(set(unknown_ids))
        super().__init__(
            "Unknown child ids for this parent: "
            + ", ".join(str(item) for item in self.unknown_ids)
        )


@dataclass(frozen=True)
class ChildOp:
    """
    Одна дія над дитиною.

    existing is None — створити; інакше оновити цей рядок. position — місце в
    payload, воно ж порядок показу: фронтенд впорядковує значення і форми
    перетягуванням, і масив приходить уже в потрібному порядку.
    """

    payload: Any
    position: int
    existing: Any | None


@dataclass(frozen=True)
class ChildPlan:
    ops: tuple[ChildOp, ...]
    orphans: tuple[Any, ...]


def plan_children(
    existing: Sequence[HasId], incoming: Sequence[HasOptionalId]
) -> ChildPlan:
    """
    Звірити наявні рядки з payload.

    Правила:
      * елемент без id            → створити;
      * елемент з відомим id      → оновити цей рядок;
      * елемент з невідомим id    → UnknownChildIdError;
      * рядок, якого немає в payload → видалити.

    Порожній payload означає «видалити всіх дітей», і це навмисно: інакше не
    можна було б прибрати останнє значення картки. Захист від випадкової
    втрати вмісту стоїть не тут, а на рівні PATCH — поле, якого немає в тілі
    запиту, взагалі не доходить до звірки.
    """
    by_id = {row.id: row for row in existing}

    unknown = [
        item.id
        for item in incoming
        if item.id is not None and item.id not in by_id
    ]
    if unknown:
        raise UnknownChildIdError(unknown)

    ops = tuple(
        ChildOp(
            payload=item,
            position=position,
            existing=by_id.get(item.id) if item.id is not None else None,
        )
        for position, item in enumerate(incoming)
    )

    kept = {item.id for item in incoming if item.id is not None}
    orphans = tuple(row for row in existing if row.id not in kept)

    return ChildPlan(ops=ops, orphans=orphans)


def is_blank(*values: str | None) -> bool:
    """Чи всі текстові поля порожні після обрізання пробілів."""
    return not any((value or "").strip() for value in values)


# --------------------------------------------------------------------------
# Застосування плану до моделей
# --------------------------------------------------------------------------


def apply_examples(sense: WordSenseModel, incoming: Sequence[Any]) -> None:
    plan = plan_children(sense.examples, incoming)

    for row in plan.orphans:
        sense.examples.remove(row)

    for op in plan.ops:
        example = op.existing
        if example is None:
            example = SenseExampleModel()
            sense.examples.append(example)
        example.position = op.position
        example.text_en = op.payload.text_en
        example.text_uk = op.payload.text_uk


def apply_senses(card: CardModel, incoming: Sequence[Any]) -> None:
    """
    Звірити значення картки з payload, приклади — всередині кожного значення.

    Приклади звіряються проти СВОГО значення, а не проти всієї картки: id
    прикладу з сусіднього значення має лишитись невідомим, інакше збереження
    однієї картки могло б перетягнути приклад із іншого її значення.
    """
    plan = plan_children(card.senses, incoming)

    for row in plan.orphans:
        card.senses.remove(row)

    for op in plan.ops:
        sense = op.existing
        if sense is None:
            sense = WordSenseModel()
            card.senses.append(sense)
        sense.position = op.position
        sense.part_of_speech = op.payload.part_of_speech
        sense.translation = op.payload.translation
        sense.transcription = op.payload.transcription
        apply_examples(sense, op.payload.examples)


def apply_forms(card: CardModel, incoming: Sequence[Any]) -> None:
    plan = plan_children(card.forms, incoming)

    for row in plan.orphans:
        card.forms.remove(row)

    for op in plan.ops:
        form = op.existing
        if form is None:
            form = WordFormModel()
            card.forms.append(form)
        form.position = op.position
        form.label = op.payload.label
        form.value = op.payload.value
        form.transcription = op.payload.transcription


def apply_list_links(card: CardModel, list_ids: Sequence[int]) -> None:
    """
    Привести мітки списків до переданого набору.

    Наявні зв'язки не перестворюються, щоб не збивати added_at: картка, яку
    просто перейменували, не має виглядати щойно доданою до списку.
    """
    wanted = list(dict.fromkeys(list_ids))
    current = {link.list_id: link for link in card.list_links}

    for list_id, link in current.items():
        if list_id not in wanted:
            card.list_links.remove(link)

    for list_id in wanted:
        if list_id not in current:
            card.list_links.append(CardListLinkModel(list_id=list_id))


def ensure_tracks(card: CardModel, now: datetime) -> None:
    """
    Доріжка перекладу є завжди; доріжка форм — щойно з'явилась перша форма.

    Зайвих доріжок ця функція НЕ прибирає, і це головне, що про неї треба знати.
    Прибрав користувач усі форми — доріжка FORMS лишається зі своєю стабільністю
    і своїми логами, а з черги вона зникає сама: `_queue_conditions` показує її
    лише за наявності форм. Видалення доріжки знищило б `review_logs` каскадом,
    тобто сировину для підбору параметрів (ADR-0002, ADR-0003), і повернута
    через місяць форма починала б з нуля.

    Саме тут API свідомо розходиться з import_legacy.py, який доріжку без форм
    видаляє: він разовий і працює по базі, де логів ще немає.
    """
    kinds = {track.kind for track in card.review_tracks}

    if ReviewKindEnum.TRANSLATION not in kinds:
        card.review_tracks.append(
            ReviewTrackModel(
                kind=ReviewKindEnum.TRANSLATION,
                state=ReviewStateEnum.NEW,
                due_at=now,
            )
        )

    if card.forms and ReviewKindEnum.FORMS not in kinds:
        card.review_tracks.append(
            ReviewTrackModel(
                kind=ReviewKindEnum.FORMS,
                state=ReviewStateEnum.NEW,
                due_at=now,
            )
        )
