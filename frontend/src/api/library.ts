/**
 * Виклики Бібліотеки.
 *
 * Два адресних простори, як і в шерингу:
 * `/vocabulary/lists/{id}/publication/` — дії власника над своїм списком,
 * `/library/…` — те, що бачить і робить читач.
 *
 * Типи не пишуться руками — вони з `schema.d.ts`.
 */

import { apiFetch } from "./client";
import type { components } from "./schema";

export type LibraryPage = components["schemas"]["LibraryPageSchema"];
export type PublicationSummary = components["schemas"]["PublicationSummarySchema"];
export type PublicationDetail = components["schemas"]["PublicationDetailSchema"];
export type PublicationOwner = components["schemas"]["PublicationOwnerSchema"];
export type SnapshotCardPage = components["schemas"]["SnapshotCardPageSchema"];
export type SnapshotCard = components["schemas"]["SnapshotCardSchema"];
export type TakeResult = components["schemas"]["PublicationTakeResultSchema"];
export type Rating = components["schemas"]["RatingSchema"];
export type ReportReason = components["schemas"]["PublicationReportReasonEnum"];

/** Порядок витрини. Значення збігаються з `Literal` у роуті. */
export type LibrarySort = "popular" | "fresh" | "rating";

export const LIBRARY_PER_PAGE = 20;
export const SNAPSHOT_CARDS_PER_PAGE = 50;

// --------------------------------------------------------------------------
// Читач
// --------------------------------------------------------------------------

export function fetchLibrary(
  page: number,
  sort: LibrarySort,
  q: string,
  signal?: AbortSignal,
): Promise<LibraryPage> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(LIBRARY_PER_PAGE),
    sort,
  });
  // Порожній `q` не надсилається взагалі: `?q=` бекенд прийме, але тоді в
  // ключі запиту й у логах з'явиться фільтр, якого людина не ставила.
  if (q.trim()) params.set("q", q.trim());

  return apiFetch<LibraryPage>(`/library/?${params}`, { signal });
}

export function fetchPublication(id: number): Promise<PublicationDetail> {
  return apiFetch<PublicationDetail>(`/library/publications/${id}/`);
}

export function fetchPublicationCards(
  id: number,
  page: number,
  signal?: AbortSignal,
): Promise<SnapshotCardPage> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(SNAPSHOT_CARDS_PER_PAGE),
  });
  return apiFetch<SnapshotCardPage>(
    `/library/publications/${id}/cards/?${params}`,
    { signal },
  );
}

/** Назву задає той, хто бере. Режиму «перезаписати» тут немає навмисно. */
export function takePublication(id: number, name: string): Promise<TakeResult> {
  return apiFetch<TakeResult>(`/library/publications/${id}/take/`, {
    method: "POST",
    body: { name },
  });
}

/** PUT: одна людина — одна оцінка, повторний виклик її замінює. */
export function ratePublication(id: number, stars: number): Promise<Rating> {
  return apiFetch<Rating>(`/library/publications/${id}/rating/`, {
    method: "PUT",
    body: { stars },
  });
}

export function reportPublication(
  id: number,
  reason: ReportReason,
): Promise<void> {
  return apiFetch<void>(`/library/publications/${id}/report/`, {
    method: "POST",
    body: { reason },
  });
}

// --------------------------------------------------------------------------
// Власник
// --------------------------------------------------------------------------

export function fetchListPublication(listId: number): Promise<PublicationOwner> {
  return apiFetch<PublicationOwner>(`/vocabulary/lists/${listId}/publication/`);
}

/**
 * Опублікувати або правити назву й опис.
 *
 * Ідемпотентно: у списку публікація щонайбільше одна. Знімок при цьому НЕ
 * перезнімається — для цього є `refreshPublication`.
 */
export function publishList(
  listId: number,
  title: string,
  description: string | null,
): Promise<PublicationOwner> {
  return apiFetch<PublicationOwner>(
    `/vocabulary/lists/${listId}/publication/`,
    { method: "POST", body: { title, description } },
  );
}

/** Перезняти знімок зі списку. Рейтинг і взяття лишаються. */
export function refreshPublication(listId: number): Promise<PublicationOwner> {
  return apiFetch<PublicationOwner>(
    `/vocabulary/lists/${listId}/publication/refresh/`,
    { method: "POST" },
  );
}

/** Зняти з витрини. Рядок і рейтинг лишаються — повернення їх відновлює. */
export function unpublishList(listId: number): Promise<void> {
  return apiFetch<void>(`/vocabulary/lists/${listId}/publication/`, {
    method: "DELETE",
  });
}
