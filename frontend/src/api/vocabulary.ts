/**
 * Виклики словника.
 *
 * Типи не пишуться руками — вони з `schema.d.ts`, згенерованого з OpenAPI.
 * Після будь-якої зміни Pydantic-схем обидві команди з README треба повторити.
 */

import { apiFetch } from "./client";
import type { components, paths } from "./schema";
import type { Card, CardCreate, CardUpdate, WordList } from "../vocabulary/card";

export type CardPage = components["schemas"]["CardPageSchema"];
export type WordListPage = components["schemas"]["WordListPageSchema"];
export type Unlisted = components["schemas"]["UnlistedSchema"];
export type VocabularyStats = components["schemas"]["VocabularyStatsSchema"];

/**
 * Порядок сторінки. Береться зі схеми, а не пишеться руками: значення мусить
 * збігатися з `Literal` у роуті, інакше одруківка обернеться на 422 в рантаймі
 * замість помилки складання.
 *
 * `created` — новіші зверху, `word` — за абеткою, `stability` — спершу холодні
 * (нові попереду, далі від найменшої стабільності).
 */
export type CardSort = NonNullable<
  NonNullable<
    paths["/api/v1/vocabulary/cards/"]["get"]["parameters"]["query"]
  >["sort"]
>;

export type CardQuery = {
  listId?: number | null;
  /** «Без списку» — це відсутність міток, а не список, тож окремий прапорець. */
  unlisted?: boolean;
  q?: string;
  sort?: CardSort;
  page?: number;
  perPage?: number;
};

export const CARDS_PER_PAGE = 50;

function cardParams(query: CardQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.listId != null) params.set("list_id", String(query.listId));
  if (query.unlisted) params.set("unlisted", "true");
  if (query.q?.trim()) params.set("q", query.q.trim());
  params.set("sort", query.sort ?? "created");
  params.set("page", String(query.page ?? 1));
  params.set("per_page", String(query.perPage ?? CARDS_PER_PAGE));
  return params;
}

export function fetchCards(
  query: CardQuery,
  signal?: AbortSignal,
): Promise<CardPage> {
  return apiFetch<CardPage>(`/vocabulary/cards/?${cardParams(query)}`, { signal });
}

/**
 * Зведення для «Прогресу».
 *
 * `stability_bands` рахує лише доріжку перекладу, тож сума смуги дорівнює
 * кількості карток. `due_tracks` рахує доріжки — воно більше за `cards`, бо
 * картка з формами дає дві. Ці два числа поруч виглядають як помилка, доки їх
 * не підписати одиницею.
 */
export function fetchStats(): Promise<VocabularyStats> {
  return apiFetch<VocabularyStats>("/vocabulary/stats/");
}

export function fetchCard(id: number): Promise<Card> {
  return apiFetch<Card>(`/vocabulary/cards/${id}/`);
}

/**
 * Точний збіг слова — перевірка дубліката перед збереженням.
 *
 * Робиться на виході з поля «слово», а не на кожному натисканні: один запит
 * замість восьми, і все одно до того, як користувач набере значення й приклади.
 * 409 при збереженні лишається страховкою на випадок гонки з іншим пристроєм.
 */
export async function findByWord(word: string): Promise<Card | null> {
  const trimmed = word.trim();
  if (!trimmed) return null;
  const page = await apiFetch<CardPage>(
    `/vocabulary/cards/?word=${encodeURIComponent(trimmed)}&per_page=1`,
  );
  return page.items[0] ?? null;
}

export function createCard(payload: CardCreate): Promise<Card> {
  return apiFetch<Card>("/vocabulary/cards/", { method: "POST", body: payload });
}

export function updateCard(id: number, payload: CardUpdate): Promise<Card> {
  return apiFetch<Card>(`/vocabulary/cards/${id}/`, {
    method: "PATCH",
    body: payload,
  });
}

export function deleteCard(id: number): Promise<void> {
  return apiFetch<void>(`/vocabulary/cards/${id}/`, { method: "DELETE" });
}

export function fetchLists(): Promise<WordListPage> {
  return apiFetch<WordListPage>("/vocabulary/lists/");
}

export function createList(name: string): Promise<WordList> {
  return apiFetch<WordList>("/vocabulary/lists/", {
    method: "POST",
    body: { name },
  });
}

export function renameList(id: number, name: string): Promise<WordList> {
  return apiFetch<WordList>(`/vocabulary/lists/${id}/`, {
    method: "PATCH",
    body: { name },
  });
}

export function deleteList(id: number): Promise<void> {
  return apiFetch<void>(`/vocabulary/lists/${id}/`, { method: "DELETE" });
}
