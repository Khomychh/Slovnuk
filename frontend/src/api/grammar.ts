/**
 * Виклики граматики.
 *
 * Типи не пишуться руками — вони з `schema.d.ts`, згенерованого з OpenAPI.
 */

import { apiFetch } from "./client";
import type { components } from "./schema";
import type { Note, NoteCategory } from "../grammar/note";

export type NotePage = components["schemas"]["GrammarNotePageSchema"];
export type CategoryPage = components["schemas"]["NoteCategoryPageSchema"];

/** Стеля бекенда (`per_page: Query(50, ge=1, le=200)`). Більше він не віддасть. */
export const NOTES_PER_PAGE = 200;

export type NotePayload = {
  title: string;
  body_markdown: string;
  category: string;
};

function fetchNotePage(page: number, signal?: AbortSignal): Promise<NotePage> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(NOTES_PER_PAGE),
  });
  return apiFetch<NotePage>(`/grammar/notes/?${params}`, { signal });
}

/**
 * Увесь довідник одним читанням.
 *
 * Пошук і фільтр за розділом навмисно НЕ передаються на сервер: клієнт тримає
 * всі нотатки й фільтрує сам (`grammar/note.ts`). Довідник важить одиниці
 * кілобайт — на відміну від словника, де серверний пошук був єдиним виходом.
 *
 * Цикл по сторінках — не запас на майбутнє, а закрита пастка: `per_page` має
 * стелю 200, тож на 201-й нотатці одноразовий запит почав би мовчки губити
 * останні. Умова спирається на `total`, а не на «прийшло рівно per_page»:
 * останнє дає зайвий порожній запит рівно тоді, коли кількість кратна 200.
 */
export async function fetchAllNotes(signal?: AbortSignal): Promise<Note[]> {
  const first = await fetchNotePage(1, signal);
  const items = [...first.items];

  for (let page = 2; items.length < first.total; page += 1) {
    const next = await fetchNotePage(page, signal);
    if (next.items.length === 0) break; // сервер більше нічого не дає — не циклимось
    items.push(...next.items);
  }

  return items;
}

export function createNote(payload: NotePayload): Promise<Note> {
  return apiFetch<Note>("/grammar/notes/", { method: "POST", body: payload });
}

export function updateNote(id: number, payload: NotePayload): Promise<Note> {
  return apiFetch<Note>(`/grammar/notes/${id}/`, { method: "PATCH", body: payload });
}

export function deleteNote(id: number): Promise<void> {
  return apiFetch<void>(`/grammar/notes/${id}/`, { method: "DELETE" });
}

export function fetchCategories(): Promise<CategoryPage> {
  return apiFetch<CategoryPage>("/grammar/categories/");
}

export function renameCategory(id: number, name: string): Promise<NoteCategory> {
  return apiFetch<NoteCategory>(`/grammar/categories/${id}/`, {
    method: "PATCH",
    body: { name },
  });
}

/**
 * Розділ зникає, нотатки лишаються — FK стоїть на `SET NULL`, тож вони їдуть у
 * «Без розділу». Екран мусить казати це вголос: у старому PWA видалення групи
 * забирало її вміст, і звичка може лишитись саме та.
 */
export function deleteCategory(id: number): Promise<void> {
  return apiFetch<void>(`/grammar/categories/${id}/`, { method: "DELETE" });
}
