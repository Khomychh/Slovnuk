/**
 * Серверні читання розділу навчання.
 *
 * Тут — і лише тут — працює TanStack Query: `/today/`, `/days/`, `/settings/`,
 * списки. Це стан, який має право перезапитатись, бо його змінює сервер.
 *
 * Буфер карток і черга відправки сюди не потрапляють навмисно (ADR-0010): їх
 * ніхто не «перезапитує», до синхронізації вони і є правда. Вони живуть у
 * `store.ts`.
 *
 * Кожне вдале читання відкладає копію в IndexedDB — інакше офлайн-відкриття
 * показало б порожній екран при повному буфері карток поруч.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDays,
  fetchLists,
  fetchSettings,
  fetchToday,
  patchSettings,
  type StudySettingsUpdate,
} from "../api/study";
import {
  detectTimeZone,
  localDay,
  resolveTimeZone,
  timeZoneNeedsSync,
  weekDays,
} from "./day";
import {
  acceptDays,
  acceptToday,
  getState,
  setTimeZone,
  subscribe,
  type StudyState,
} from "./store";

/** Стан навчання цілком. Компонент перемальовується на будь-яку його зміну. */
export function useStudy(): StudyState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function useSettings() {
  const query = useQuery({
    queryKey: ["study", "settings"],
    queryFn: fetchSettings,
    // Налаштування міняє сам користувач і рідко — смикати їх частіше немає сенсу.
    staleTime: 5 * 60_000,
  });

  // Пояс потрібен сховищу, щоб рахувати добу так само, як її рахує сервер.
  useEffect(() => {
    if (query.data) setTimeZone(resolveTimeZone(query.data.timezone));
  }, [query.data]);

  return query;
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: StudySettingsUpdate) => patchSettings(payload),
    onSuccess: (settings) => {
      client.setQueryData(["study", "settings"], settings);
    },
  });
}

/**
 * Пояс їде за телефоном.
 *
 * Органу керування поясом у профілі немає — там лише рядок із поточним
 * значенням. Причини й наслідки описані в `timeZoneNeedsSync`; тут лише місце,
 * де це трапляється: каркас вкладок, тобто будь-який екран застосунку.
 *
 * Невдача (немає мережі) нічого не ламає: наступне відкриття спробує знову.
 */
export function useTimeZoneSync() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const stored = settings.data?.timezone;
  const { mutate } = update;

  useEffect(() => {
    if (stored === undefined) return;
    const detected = detectTimeZone();
    if (!timeZoneNeedsSync(stored, detected)) return;
    mutate({ timezone: detected });
  }, [stored, mutate]);
}

export function useToday() {
  const query = useQuery({
    queryKey: ["study", "today"],
    queryFn: fetchToday,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.data) void acceptToday(query.data);
  }, [query.data]);

  return query;
}

/** Сім діб поточного тижня — крапки на екрані «Сьогодні». */
export function useWeek(timezone: string | undefined) {
  const days = weekDays(localDay(new Date(), resolveTimeZone(timezone)));
  const from = days[0];
  const to = days[6];

  const query = useQuery({
    queryKey: ["study", "days", from, to],
    queryFn: () => fetchDays(from, to),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.data) void acceptDays(query.data);
  }, [query.data]);

  return { ...query, days };
}

export function useLists() {
  return useQuery({
    queryKey: ["vocabulary", "lists"],
    queryFn: fetchLists,
    staleTime: 60_000,
  });
}
