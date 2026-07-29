/**
 * Виклики шерингу.
 *
 * Два адресних простори, і це не примха бекенду: `/vocabulary/lists/{id}/share/`
 * — дії власника над своїм списком, `/shares/{token}/` — те, що бачить і робить
 * отримувач. Обидва вимагають логіну.
 *
 * Типи не пишуться руками — вони з `schema.d.ts`.
 */

import { apiFetch } from "./client";
import type { components } from "./schema";

export type Share = components["schemas"]["ShareSchema"];
export type SharePreview = components["schemas"]["SharePreviewSchema"];
export type SharedCardPage = components["schemas"]["SharedCardPageSchema"];
export type SharedCard = components["schemas"]["SharedCardSchema"];
export type ImportResult = components["schemas"]["ShareImportResultSchema"];
export type ImportMode = components["schemas"]["ImportMode"];

export const SHARED_CARDS_PER_PAGE = 50;

/** Ідемпотентно: у списку рівно одне активне посилання. */
export function shareList(listId: number): Promise<Share> {
  return apiFetch<Share>(`/vocabulary/lists/${listId}/share/`, { method: "POST" });
}

/** Гасить посилання. Увімкнути знову — це вже інший токен. */
export function unshareList(listId: number): Promise<void> {
  return apiFetch<void>(`/vocabulary/lists/${listId}/share/`, { method: "DELETE" });
}

export function fetchSharePreview(token: string): Promise<SharePreview> {
  return apiFetch<SharePreview>(`/shares/${encodeURIComponent(token)}/`);
}

export function fetchSharedCards(
  token: string,
  page: number,
  signal?: AbortSignal,
): Promise<SharedCardPage> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(SHARED_CARDS_PER_PAGE),
  });
  return apiFetch<SharedCardPage>(
    `/shares/${encodeURIComponent(token)}/cards/?${params}`,
    { signal },
  );
}

export function importShare(
  token: string,
  name: string,
  mode: ImportMode,
): Promise<ImportResult> {
  return apiFetch<ImportResult>(`/shares/${encodeURIComponent(token)}/import/`, {
    method: "POST",
    body: { name, mode },
  });
}
