/**
 * «Граматика» — корінь вкладки.
 *
 * Плоский список усіх нотаток, розділ працює фільтром. Форма та сама, що в
 * словнику, але причина інша: там список плоский, бо списки-мітки нічого не
 * розділяли (ADR-0011); тут — бо дев'ять заголовків це один екран, і
 * двоступеневий акордеон вимагав би двох тапів, щоб прочитати одне правило.
 *
 * Пошук і фільтр рахує КЛІЄНТ, на відміну від словника. Довідник приїжджає
 * цілком (одиниці кілобайт), тож серверний пошук був би другою реалізацією
 * того, що вже є локально — і при цьому гасив би пошук офлайн.
 *
 * Бекенд віддає нотатки в порядку `category_id NULLS LAST, position, id`, тож
 * розділи в плоскому списку групуються самі, без сортування на клієнті.
 */

import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { Screen } from "../ui/parts";
import { notes as notesLabel } from "../ui/plural";
import CategoryFilterSheet, {
  ALL_CATEGORIES,
  type CategoryPick,
} from "../grammar/CategoryFilterSheet";
import { useCategories, useNotes } from "../grammar/queries";
import { filterNotes, snippet, type Note } from "../grammar/note";

function NoteRow({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const preview = snippet(note.body_markdown);

  return (
    <button className="g-row" type="button" onClick={onOpen}>
      <span className="g-row-head">
        <span className="g-title">{note.title}</span>
        {note.category_name ? (
          <span className="g-tag">{note.category_name}</span>
        ) : null}
      </span>
      {preview ? <span className="g-snippet">{preview}</span> : null}
    </button>
  );
}

export default function GrammarScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();

  const [pick, setPick] = useState<CategoryPick>(ALL_CATEGORIES);
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  const all = useNotes();
  const categories = useCategories();

  const visible = useMemo(() => {
    const source = all.data ?? [];
    const byCategory = pick.uncategorized
      ? source.filter((note) => note.category_id === null)
      : pick.categoryId === null
        ? source
        : source.filter((note) => note.category_id === pick.categoryId);
    return filterNotes(byCategory, query);
  }, [all.data, pick, query]);

  const activeName = pick.uncategorized
    ? "Без розділу"
    : pick.categoryId === null
      ? "Усі нотатки"
      : (categories.data?.items.find((item) => item.id === pick.categoryId)?.name ??
        "Розділ");

  /** Новій нотатці підставляється відкритий розділ — так само, як список у словнику. */
  const newNoteCategory = pick.uncategorized
    ? ""
    : (categories.data?.items.find((item) => item.id === pick.categoryId)?.name ?? "");

  const openNote = (id: number) => {
    // Маршрут справжній, але малюється аркушем поверх списку: системне «назад»
    // тоді працює даром, а набраний запит і позиція скролу не гинуть.
    navigate(`/grammar/notes/${id}`, { state: { background: location } });
  };

  return (
    <Screen title="Граматика" aside={<ProfileAvatar />}>
      <div className="v-summary">{notesLabel(all.data?.length ?? 0)}</div>

      {/* Поле активне й офлайн — на відміну від словника. Увесь довідник лежить
          у кеші, тож шукати без звʼязку тут можна по-справжньому. */}
      <input
        className="v-search"
        type="search"
        inputMode="search"
        autoCapitalize="none"
        autoComplete="off"
        placeholder="Пошук: назва або текст правила"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="v-controls">
        <button className="v-filter" type="button" onClick={() => setSheetOpen(true)}>
          {activeName} ▾
        </button>
      </div>

      {all.isPending ? <div className="hint">Завантаження…</div> : null}

      {all.isError ? (
        <div className="hint">
          {online
            ? "Не вдалось завантажити довідник."
            : "Немає звʼязку, а довідник ще не завантажувався."}
        </div>
      ) : null}

      {!all.isPending && !all.isError && visible.length === 0 ? (
        <div className="stub">
          {query.trim()
            ? `За запитом «${query.trim()}» нічого не знайшлось.`
            : (all.data?.length ?? 0) === 0
              ? "Тут поки порожньо. Запишіть перше правило кнопкою «+»."
              : "У цьому розділі нотаток немає."}
        </div>
      ) : null}

      <div className="g-list">
        {visible.map((note) => (
          <NoteRow key={note.id} note={note} onOpen={() => openNote(note.id)} />
        ))}
      </div>

      <button
        className="v-add"
        type="button"
        disabled={!online}
        title={online ? "Нова нотатка" : "Потрібен звʼязок"}
        onClick={() =>
          navigate("/grammar/notes/new", {
            state: { background: location, category: newNoteCategory },
          })
        }
      >
        +
      </button>

      {sheetOpen ? (
        <CategoryFilterSheet
          pick={pick}
          onPick={(next) => {
            setPick(next);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </Screen>
  );
}
