/**
 * Виклики розділу навчання.
 *
 * Типи не пишуться руками — вони з `schema.d.ts`, згенерованого з OpenAPI. Після
 * будь-якої зміни Pydantic-схем обидві команди з README треба повторити, інакше
 * TypeScript перестане ловити саме те, заради чого його взяли.
 */

import { apiFetch } from "./client";
import type { components } from "./schema";

export type QueueResponse = components["schemas"]["QueueResponseSchema"];
export type TrackReviewResponse = components["schemas"]["TrackReviewResponseSchema"];
export type TodayResponse = components["schemas"]["StudyDayResponseSchema"];
export type DaysResponse = components["schemas"]["StudyDaysResponseSchema"];
export type StudyDay = components["schemas"]["StudyDaySchema"];
export type StudySettings = components["schemas"]["StudySettingsResponseSchema"];
export type StudySettingsUpdate = components["schemas"]["StudySettingsUpdateSchema"];
export type StudyDirection = components["schemas"]["StudyDirectionEnum"];
export type WordListPage = components["schemas"]["WordListPageSchema"];

/**
 * Черга.
 *
 * `offset` тут немає навмисно: відповідь виштовхує доріжку з черги, тож черга
 * коротшає під час сесії і зсунута сторінка пропускала б картки. Питаємо щоразу
 * перші N.
 */
export function fetchQueue(
  listIds: number[],
  limit = 50,
  signal?: AbortSignal,
): Promise<QueueResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  for (const id of listIds) params.append("list_ids", String(id));
  return apiFetch<QueueResponse>(`/study/queue/?${params}`, { signal });
}

export function postReview(
  trackId: number,
  rating: number,
  reviewDuration: number,
): Promise<TrackReviewResponse> {
  return apiFetch<TrackReviewResponse>(`/study/tracks/${trackId}/review/`, {
    method: "POST",
    // review_duration шлеться завжди: без нього оптимізатор FSRS не працює, а
    // заднім числом цих мілісекунд не буде (ADR-0002).
    body: { rating, review_duration: reviewDuration },
  });
}

export function fetchToday(): Promise<TodayResponse> {
  return apiFetch<TodayResponse>("/study/today/");
}

/** Календар. Без from/to — уся історія; для крапок тижня беремо сім діб. */
export function fetchDays(from?: string, to?: string): Promise<DaysResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return apiFetch<DaysResponse>(`/study/days/${query ? `?${query}` : ""}`);
}

export function fetchSettings(): Promise<StudySettings> {
  return apiFetch<StudySettings>("/study/settings/");
}

export function patchSettings(payload: StudySettingsUpdate): Promise<StudySettings> {
  return apiFetch<StudySettings>("/study/settings/", {
    method: "PATCH",
    body: payload,
  });
}

export function fetchLists(): Promise<WordListPage> {
  return apiFetch<WordListPage>("/vocabulary/lists/");
}
