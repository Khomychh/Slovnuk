"""
Перенос даних зі старого PWA (index.html, localStorage) у базу.

Вхід — файл, який старий додаток віддає кнопкою «Зберегти файл»:

    {"lists": [...], "cards": [...], "notes": [...]}

Запуск із теки backend:

    python -m scripts.import_legacy --file slovnyk-2026-07-27.json \\
        --email ivan@example.com [--dry-run]

Скрипт ідемпотентний: списки зіставляються за назвою, картки — за
нормалізованим словом. Повторний запуск оновлює наявні записи, а не
створює дублікати.

ВАЖЛИВО: переноситься ЗМІСТ, але не історія — див.
docs/adr/0004-import-perenosyt-zmist-ne-istoriiu.md.

Не переноситься нічого з переліченого, і це навмисно:

* прогрес повторень — усі доріжки створюються в стані NEW (ADR-0001,
  докстринг `Importer._ensure_track`);
* дати створення — поле `created` у файлі є, але ігнорується: усе
  створюється днем імпорту;
* календар виконаних днів, лічильники повторів і налаштування зі
  `words_app_meta_v1` — ключ localStorage не читається взагалі,
  `study_days` починається порожньою.

Наявні доріжки скрипт не чіпає, тож перезапуск після початку навчання
нічого не скине.
"""

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

# Дозволяє запускати файл напряму: python scripts/import_legacy.py
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database.database import get_db_contextmanager  # noqa: E402
from app.database.models import (  # noqa: E402
    CardListLinkModel,
    CardModel,
    GrammarNoteModel,
    NoteCategoryModel,
    PartOfSpeechEnum,
    ReviewKindEnum,
    ReviewStateEnum,
    ReviewTrackModel,
    SenseExampleModel,
    UserModel,
    WordFormModel,
    WordListModel,
    WordSenseModel,
    normalize_word,
)

MAX_WORD_LENGTH = 100
MAX_LIST_NAME_LENGTH = 100
MAX_NOTE_TITLE_LENGTH = 255


class ImportError_(Exception):
    """Помилка, яку показуємо користувачу без стектрейсу."""


# --------------------------------------------------------------------------
# Розбір старого формату
# --------------------------------------------------------------------------

def parse_examples(raw: str) -> list[tuple[str, str | None]]:
    """
    У старому форматі всі приклади значення лежать в одному рядку:

        I made a decision. | Я ухвалив рішення.
        It was hard. | Це було важко.

    Кожен рядок — окремий приклад, «|» відділяє переклад.
    """
    out: list[tuple[str, str | None]] = []
    for line in (raw or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        if "|" in line:
            en, uk = line.split("|", 1)
            en, uk = en.strip(), uk.strip()
            if en:
                out.append((en, uk or None))
        else:
            out.append((line, None))
    return out


def parse_pos(raw) -> PartOfSpeechEnum | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return PartOfSpeechEnum(raw.strip())
    except ValueError:
        return PartOfSpeechEnum.OTHER


def sense_is_empty(sense: dict) -> bool:
    # `gloss` тут навмисно немає: поле знесено з моделі, і значення, у якого є
    # ЛИШЕ уточнення, вважається порожнім — переносити з нього нічого.
    return not any(
        str(sense.get(key) or "").strip() for key in ("pos", "tr", "ipa", "ex")
    )


def card_reps(card: dict) -> int:
    value = card.get("reps")
    return value if isinstance(value, (int, float)) else 0


def read_json(path: Path):
    if not path.exists():
        raise ImportError_(f"Файл не знайдено: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ImportError_(f"{path} — це не коректний JSON: {exc}") from exc


def extract_payload(raw) -> tuple[list, list, list]:
    """Приймає і повний експорт, і голий масив карток зі старих версій."""
    if isinstance(raw, list):
        return [], raw, []
    if isinstance(raw, dict) and isinstance(raw.get("cards"), list):
        return (
            raw.get("lists") if isinstance(raw.get("lists"), list) else [],
            raw["cards"],
            raw.get("notes") if isinstance(raw.get("notes"), list) else [],
        )
    raise ImportError_(
        "Не схоже на експорт зі Slovnuk. Очікую обʼєкт з ключем 'cards'."
    )


# --------------------------------------------------------------------------
# Перевірки перед записом
# --------------------------------------------------------------------------

def validate(lists: list, cards: list, notes: list) -> list[str]:
    """Збирає всі проблеми одразу, щоб не падати на середині імпорту."""
    problems: list[str] = []

    for item in lists:
        name = str((item or {}).get("name") or "").strip()
        if len(name) > MAX_LIST_NAME_LENGTH:
            problems.append(f"Назва списку задовга ({len(name)} символів): {name[:60]}…")

    for card in cards:
        word = str((card or {}).get("word") or "").strip()
        if not word:
            continue
        if len(word) > MAX_WORD_LENGTH:
            problems.append(f"Слово задовге ({len(word)} символів): {word[:60]}…")

    for note in notes:
        title = str((note or {}).get("title") or "").strip()
        if len(title) > MAX_NOTE_TITLE_LENGTH:
            problems.append(f"Заголовок нотатки задовгий ({len(title)}): {title[:60]}…")

    return problems


# --------------------------------------------------------------------------
# Імпорт
# --------------------------------------------------------------------------

class Importer:
    def __init__(self, session: AsyncSession, user: UserModel):
        self.session = session
        self.user = user
        self.stats: dict[str, int] = defaultdict(int)
        self.merged: list[str] = []
        # Спільний момент для всіх нових доріжок, щоб черга не «сходинкувалась»
        # за часом обробки карток.
        self.imported_at = datetime.now(timezone.utc)

    # ---- списки ----

    async def import_lists(self, raw_lists: list) -> dict[str, WordListModel]:
        """Повертає мапу «старий id списку» → модель."""
        existing = {
            row.name: row
            for row in (
                await self.session.scalars(
                    select(WordListModel).where(WordListModel.user_id == self.user.id)
                )
            ).all()
        }

        by_legacy_id: dict[str, WordListModel] = {}
        used_names = set(existing)

        for position, item in enumerate(raw_lists or []):
            item = item or {}
            legacy_id = str(item.get("id") or "")
            name = str(item.get("name") or "").strip() or "Список"

            # UNIQUE(user_id, name): у старому додатку назви могли повторюватись
            if name not in existing:
                base, counter = name, 2
                while name in used_names:
                    name = f"{base} ({counter})"
                    counter += 1

            word_list = existing.get(name)
            if word_list is None:
                word_list = WordListModel(
                    user_id=self.user.id,
                    name=name,
                    position=position,
                )
                self.session.add(word_list)
                used_names.add(name)
                self.stats["lists_created"] += 1
            else:
                self.stats["lists_reused"] += 1

            if legacy_id:
                by_legacy_id[legacy_id] = word_list

        await self.session.flush()
        return by_legacy_id

    # ---- картки ----

    async def import_cards(self, raw_cards: list, lists_by_legacy_id: dict) -> None:
        """
        Старий додаток дозволяв одне й те саме слово у звичайному та
        незалежному списках — це були дві картки з двома графіками.

        Нова модель забороняє дублікати всередині користувача, тож група
        однакових слів зливається в одну картку.

        Прогрес береться з найбільш вивченого екземпляра (найбільше повторів),
        а зміст — з усіх: значення обʼєднуються, мітки списків теж. Втрачати
        переклади при міграції не можна — зайве значення легко видалити
        руками, а зникле не відновиш.
        """
        groups: dict[str, list[dict]] = defaultdict(list)
        for card in raw_cards or []:
            card = card or {}
            word = str(card.get("word") or "").strip()
            if not word:
                self.stats["cards_skipped_empty"] += 1
                continue
            groups[normalize_word(word)].append(card)

        for key, group in groups.items():
            group.sort(key=lambda c: (card_reps(c), str(c.get("due") or "")), reverse=True)
            primary = group[0]

            if len(group) > 1:
                self.merged.append(str(primary.get("word") or "").strip())
                self.stats["cards_merged"] += len(group) - 1

            card = await self._upsert_card(key, group)

            legacy_list_ids = {
                str(item.get("listId") or "") for item in group if item.get("listId")
            }
            await self._link_lists(card, legacy_list_ids, lists_by_legacy_id)

    @staticmethod
    def _merge_senses(group: list[dict]) -> list[dict]:
        """Значення з усіх дублікатів, без точних повторів. Основний — першим."""
        merged: list[dict] = []
        seen: set[tuple[str, str]] = set()

        for item in group:
            raw_senses = item.get("senses") if isinstance(item.get("senses"), list) else []

            # До появи senses слово мало плоскі поля ipa/tr/ex
            if not raw_senses and any(
                str(item.get(key) or "").strip() for key in ("ipa", "tr", "ex")
            ):
                raw_senses = [{
                    "pos": "",
                    "ipa": item.get("ipa"),
                    "tr": item.get("tr"),
                    "ex": item.get("ex"),
                }]

            for sense in raw_senses:
                sense = sense or {}
                if sense_is_empty(sense):
                    continue
                key = (
                    str(sense.get("pos") or "").strip().lower(),
                    str(sense.get("tr") or "").strip().lower(),
                )
                if key in seen:
                    continue
                seen.add(key)
                merged.append(sense)

        return merged

    async def _upsert_card(self, normalized: str, group: list[dict]) -> CardModel:
        raw = group[0]

        # Форми беремо з першого екземпляра, який їх має
        forms_source = next(
            (item for item in group if isinstance(item.get("forms"), dict)), None
        )
        # Коментар — з першого непорожнього
        comment = next(
            (str(item.get("cmt") or "").strip() for item in group if str(item.get("cmt") or "").strip()),
            None,
        )
        senses = self._merge_senses(group)

        card = await self.session.scalar(
            select(CardModel)
            .where(
                CardModel.user_id == self.user.id,
                CardModel.word_normalized == normalized,
            )
            .options(
                selectinload(CardModel.senses).selectinload(WordSenseModel.examples),
                selectinload(CardModel.forms),
                selectinload(CardModel.review_tracks),
            )
        )

        forms_raw = forms_source.get("forms") if forms_source else None
        drill_enabled = bool(forms_raw.get("drill", True)) if forms_raw else True

        is_new = card is None
        if is_new:
            # Колекції наповнюємо ДО flush: у persistent-обʼєкта звернення до
            # незавантаженого relationship викликало б ліниве читання, а воно
            # в async-сесії падає з MissingGreenlet.
            # created_at лишається дефолтним, тобто моментом імпорту: дата
            # `created` зі старого файлу свідомо ігнорується (ADR-0004).
            card = CardModel(
                user_id=self.user.id,
                word=str(raw.get("word") or "").strip(),
                comment=comment,
                forms_drill_enabled=drill_enabled,
            )
            self.stats["cards_created"] += 1
        else:
            card.word = str(raw.get("word") or "").strip()
            card.comment = comment
            card.forms_drill_enabled = drill_enabled
            # Повторний запуск не має плодити значення й форми
            card.senses.clear()
            card.forms.clear()
            self.stats["cards_updated"] += 1

        self._rebuild_senses(card, senses)
        self._rebuild_forms(card, forms_raw)
        self._sync_tracks(card, forms_raw)

        if is_new:
            self.session.add(card)
        await self.session.flush()
        return card

    def _rebuild_senses(self, card: CardModel, senses: list[dict]) -> None:
        position = 0
        for item in senses:
            sense = WordSenseModel(
                position=position,
                part_of_speech=parse_pos(item.get("pos")),
                translation=str(item.get("tr") or "").strip() or None,
                transcription=str(item.get("ipa") or "").strip() or None,
            )
            for example_position, (text_en, text_uk) in enumerate(
                parse_examples(str(item.get("ex") or ""))
            ):
                sense.examples.append(
                    SenseExampleModel(
                        position=example_position,
                        text_en=text_en,
                        text_uk=text_uk,
                    )
                )
                self.stats["examples"] += 1

            card.senses.append(sense)
            self.stats["senses"] += 1
            position += 1

    def _rebuild_forms(self, card: CardModel, forms_raw: dict | None) -> None:
        items = (forms_raw or {}).get("items")
        if not isinstance(items, list):
            return

        position = 0
        for item in items:
            item = item or {}
            value = str(item.get("f") or "").strip()
            if not value:
                continue
            card.forms.append(
                WordFormModel(
                    position=position,
                    label=str(item.get("lbl") or "").strip() or None,
                    value=value,
                    transcription=str(item.get("ipa") or "").strip() or None,
                )
            )
            self.stats["forms"] += 1
            position += 1

    def _sync_tracks(self, card: CardModel, forms_raw: dict | None) -> None:
        by_kind = {track.kind: track for track in card.review_tracks}

        self._ensure_track(card, by_kind, ReviewKindEnum.TRANSLATION)

        if card.forms:
            self._ensure_track(card, by_kind, ReviewKindEnum.FORMS)
        elif ReviewKindEnum.FORMS in by_kind:
            card.review_tracks.remove(by_kind[ReviewKindEnum.FORMS])

    def _ensure_track(self, card: CardModel, by_kind: dict, kind: ReviewKindEnum) -> None:
        """
        Створює доріжку в стані NEW. Прогрес зі старого PWA НЕ переноситься.

        Величини SM-2 (ef / interval / reps) у FSRS не конвертуються: точної
        формули не існує, а історії повторень, з якої її можна було б
        відтворити, старий додаток не зберігав — там були лише лічильники
        meta.log[date] = {n, r}. Насіяні «на око» stability/difficulty гірші
        за їх відсутність: оптимізатор програє історію кожної картки з
        чистого fsrs.Card (optimizer.py, `if i == 0: card = Card(...)`), тому
        логи насіяних карток виглядали б як нові картки з неможливо довгими
        інтервалами і зміщували б w[2] для всіх справді нових слів.

        Ціна рішення — 594 картки треба один раз переглянути наново. Слово,
        яке ти справді знаєш, після одного «Легко» йде на 8 днів, після
        другого — на 66.
        """
        if kind in by_kind:
            # Доріжка вже існує. Не чіпаємо: скрипт можна перезапускати вже
            # після того, як користувач почав повторювати, і скидати йому
            # прогрес через повторний імпорт словника неприпустимо.
            self.stats["tracks_kept"] += 1
            return

        card.review_tracks.append(
            ReviewTrackModel(
                kind=kind,
                state=ReviewStateEnum.NEW,
                step=None,
                due_at=self.imported_at,
                last_reviewed_at=None,
                stability=None,
                difficulty=None,
            )
        )
        self.stats["tracks_created"] += 1

    async def _link_lists(self, card: CardModel, legacy_ids: set, lists_by_legacy_id: dict) -> None:
        existing = set(
            (
                await self.session.scalars(
                    select(CardListLinkModel.list_id).where(
                        CardListLinkModel.card_id == card.id
                    )
                )
            ).all()
        )

        for legacy_id in legacy_ids:
            word_list = lists_by_legacy_id.get(legacy_id)
            if word_list is None or word_list.id in existing:
                continue
            self.session.add(
                CardListLinkModel(card_id=card.id, list_id=word_list.id)
            )
            existing.add(word_list.id)
            self.stats["links_created"] += 1

    # ---- граматика ----

    async def import_notes(self, raw_notes: list) -> None:
        categories = {
            row.name: row
            for row in (
                await self.session.scalars(
                    select(NoteCategoryModel).where(NoteCategoryModel.user_id == self.user.id)
                )
            ).all()
        }
        existing_notes = {
            row.title: row
            for row in (
                await self.session.scalars(
                    select(GrammarNoteModel).where(GrammarNoteModel.user_id == self.user.id)
                )
            ).all()
        }

        for position, item in enumerate(raw_notes or []):
            item = item or {}
            title = str(item.get("title") or "").strip()
            if not title:
                self.stats["notes_skipped_empty"] += 1
                continue

            category = None
            category_name = str(item.get("cat") or "").strip()
            if category_name:
                category = categories.get(category_name)
                if category is None:
                    category = NoteCategoryModel(
                        user_id=self.user.id,
                        name=category_name,
                        position=len(categories),
                    )
                    self.session.add(category)
                    categories[category_name] = category
                    self.stats["note_categories_created"] += 1
                    await self.session.flush()

            note = existing_notes.get(title)
            if note is None:
                note = GrammarNoteModel(
                    user_id=self.user.id,
                    title=title,
                    position=position,
                )
                self.session.add(note)
                existing_notes[title] = note
                self.stats["notes_created"] += 1
            else:
                self.stats["notes_updated"] += 1

            note.body_markdown = item.get("body") if isinstance(item.get("body"), str) else None
            # Пишемо FK напряму: присвоєння relationship потягнуло б попереднє
            # значення через lazy-load, а це в async-сесії заборонено.
            note.category_id = category.id if category else None

        await self.session.flush()


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

async def run(args) -> int:
    payload = read_json(Path(args.file))
    raw_lists, raw_cards, raw_notes = extract_payload(payload)

    problems = validate(raw_lists, raw_cards, raw_notes)
    if problems:
        print("Імпорт зупинено — спершу треба полагодити дані:\n", file=sys.stderr)
        for problem in problems:
            print(f"  • {problem}", file=sys.stderr)
        return 1

    async with get_db_contextmanager() as session:
        user = await session.scalar(select(UserModel).where(UserModel.email == args.email.lower()))
        if user is None:
            emails = (await session.scalars(select(UserModel.email).limit(20))).all()
            hint = "\n".join(f"  • {email}" for email in emails) or "  (жодного користувача немає)"
            raise ImportError_(
                f"Користувача {args.email} не знайдено. Наявні:\n{hint}"
            )

        importer = Importer(session, user)

        lists_by_legacy_id = await importer.import_lists(raw_lists)
        await importer.import_cards(raw_cards, lists_by_legacy_id)
        await importer.import_notes(raw_notes)

        if args.dry_run:
            await session.rollback()
        else:
            await session.commit()

    print(f"\n{'ПРОБНИЙ ЗАПУСК — нічого не записано' if args.dry_run else 'Готово'}\n")
    for key in sorted(importer.stats):
        print(f"  {key:28} {importer.stats[key]}")

    if importer.merged:
        print(
            f"\n  Злито дублікатів слів: {len(importer.merged)}."
            "\n  У старому додатку вони жили в незалежних списках окремими картками."
            "\n  Прогрес узято з найбільш вивченого екземпляра, мітки списків — з усіх:"
        )
        for word in sorted(importer.merged)[:20]:
            print(f"    • {word}")
        if len(importer.merged) > 20:
            print(f"    … та ще {len(importer.merged) - 20}")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Перенос даних зі старого PWA Slovnuk у Postgres.",
    )
    parser.add_argument("--file", required=True, help="JSON-експорт зі старого додатку")
    parser.add_argument("--email", required=True, help="Email користувача-власника")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Показати, що станеться, і відкотити транзакцію",
    )
    args = parser.parse_args()

    try:
        return asyncio.run(run(args))
    except ImportError_ as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
