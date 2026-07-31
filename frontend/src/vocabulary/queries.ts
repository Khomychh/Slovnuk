/**
 * Серверні читання й записи словника.
 *
 * На відміну від навчання, тут немає буфера й черги відправки: словник офлайн
 * лише читається (ADR-0007). Тому весь стан — звичайний TanStack Query, а
 * IndexedDB використовується як підкладка на випадок офлайн-відкриття, а не як
 * джерело правди.
 */

import { useCallback } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CARDS_PER_PAGE,
  createCard,
  createList,
  deleteCard,
  deleteList,
  fetchCard,
  fetchCards,
  fetchLists,
  fetchStats,
  renameList,
  updateCard,
  type CardPage,
  type CardQuery,
  type CardSort,
} from "../api/vocabulary";
import { dropPages, readLists, readPage, writeLists, writePage } from "./db";
import { localDay } from "../study/day";
import type { Card, CardCreate, CardUpdate } from "./card";

/** Що саме показує список: фільтр, пошук і порядок разом. */
export type Browse = {
  listId: number | null;
  unlisted: boolean;
  q: string;
  sort: CardSort;
};

export const EMPTY_BROWSE: Browse = {
  listId: null,
  unlisted: false,
  q: "",
  sort: "created",
};

function browseKey(browse: Browse): string {
  return [
    browse.listId ?? "all",
    browse.unlisted ? "unlisted" : "",
    browse.q.trim().toLowerCase(),
    browse.sort,
  ].join("|");
}

function toQuery(browse: Browse, page: number): CardQuery {
  return {
    listId: browse.listId,
    unlisted: browse.unlisted,
    q: browse.q,
    sort: browse.sort,
    page,
  };
}

/**
 * Сторінки словника.
 *
 * `getNextPageParam` рахує наступну сторінку з `total`, а не з «прийшло рівно
 * per_page»: останній варіант дає зайвий порожній запит рівно тоді, коли
 * кількість карток кратна 50.
 */
export function useCards(browse: Browse) {
  const key = browseKey(browse);

  return useInfiniteQuery({
    queryKey: ["vocabulary", "cards", key],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      const cacheKey = `${key}#${pageParam}`;
      try {
        const page = await fetchCards(toQuery(browse, pageParam as number), signal);
        void writePage(cacheKey, page);
        return page;
      } catch (error) {
        // Офлайн — показуємо те, що вже бачили. Якщо цієї сторінки ніколи не
        // відкривали, чесніше показати помилку, ніж порожній список: порожній
        // виглядав би як «слів немає».
        const cached = await readPage(cacheKey);
        if (cached) return cached;
        throw error;
      }
    },
    getNextPageParam: (last: CardPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
    staleTime: 60_000,
  });
}

/** Плоский масив карток з усіх завантажених сторінок. */
export function flatten(pages: CardPage[] | undefined): Card[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

export function useCard(id: number | null) {
  const client = useQueryClient();

  return useQuery({
    queryKey: ["vocabulary", "card", id],
    enabled: id !== null,
    queryFn: () => fetchCard(id as number),
    // Картка вже приїхала цілком у складі сторінки — CardSchema не має
    // полегшеного варіанта. Тож перегляд відкривається без запиту, а мережа
    // потрібна лише для оновлення.
    initialData: () => {
      const pages = client
        .getQueriesData<{ pages: CardPage[] }>({
          queryKey: ["vocabulary", "cards"],
        })
        .flatMap(([, data]) => data?.pages ?? []);
      return flatten(pages).find((card) => card.id === id);
    },
    staleTime: 60_000,
  });
}

/**
 * Зведення словника: скільки карток, доріжок на повторення, вивчених і теплова
 * смуга. Живе тут, а не в екрані, бо потрібне двом: «Прогресу» (усе) і
 * «Спискам» (лише `cards` — знаменник смуги-частки).
 */
/**
 * Слова, додані сьогодні, — хвіст екрана «Сьогодні».
 *
 * Свого запиту на бекенді для цього немає й не треба: перша сторінка словника
 * в порядку створення вже містить усе, що додано за сьогодні, і ще трохи.
 * Відсікання по добі робиться тут, бо «сьогодні» рахується в поясі
 * користувача, а не сервера.
 *
 * Пʼятдесят — не ліміт слів, а ліміт вибірки, і він мусить бути свідомо вищим
 * за будь-який реальний день: на «Сьогодні» показуються ВСІ додані за добу, тож
 * обрізана вибірка мовчки з'їдала б слова, які людина щойно додала. Двадцяти
 * вистачало, поки в рядок влазило чотири, а решта згорталась у «ще N».
 */
export function useAddedToday(day: string, timeZone: string) {
  return useQuery({
    queryKey: ["vocabulary", "added", day],
    queryFn: () => fetchCards({ sort: "created", page: 1, perPage: 50 }),
    staleTime: 60_000,
    // Порівнюється саме локальний день, а не перші десять символів ISO-рядка:
    // той рядок в UTC, і о першій ночі за Києвом він показував би вчорашню
    // дату — тобто слово, додане щойно, у «сьогодні» не потрапило б.
    select: (page: CardPage) =>
      page.items.filter(
        (card) => localDay(new Date(card.created_at), timeZone) === day,
      ),
  });
}

export function useVocabularyStats() {
  return useQuery({
    queryKey: ["vocabulary", "stats"],
    queryFn: fetchStats,
    staleTime: 60_000,
  });
}

export function useLists() {
  return useQuery({
    queryKey: ["vocabulary", "lists"],
    queryFn: async () => {
      try {
        const page = await fetchLists();
        void writeLists(page);
        return page;
      } catch (error) {
        const cached = await readLists();
        if (cached) return cached;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

/**
 * Скинути все, на що впливає зміна картки.
 *
 * Списки теж: у них лічильники карток і прострочених доріжок, і без цього
 * «Загальний · 540» після додавання слова показував би 540.
 */
function useInvalidateVocabulary() {
  const client = useQueryClient();

  return useCallback(async () => {
    await dropPages();
    await client.invalidateQueries({ queryKey: ["vocabulary"] });
    // Лічильник «нових слів за сьогодні» рахується з cards.created_at, тож
    // створення картки міняє і «Сьогодні».
    await client.invalidateQueries({ queryKey: ["study", "today"] });
  }, [client]);
}

export function useCreateCard() {
  const invalidate = useInvalidateVocabulary();

  return useMutation({
    mutationFn: (payload: CardCreate) => createCard(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateCard() {
  const client = useQueryClient();
  const invalidate = useInvalidateVocabulary();

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CardUpdate }) =>
      updateCard(id, payload),
    onSuccess: async (card) => {
      client.setQueryData(["vocabulary", "card", card.id], card);
      await invalidate();
    },
  });
}

export function useDeleteCard() {
  const client = useQueryClient();
  const invalidate = useInvalidateVocabulary();

  return useMutation({
    mutationFn: (id: number) => deleteCard(id),
    onSuccess: async (_result, id) => {
      client.removeQueries({ queryKey: ["vocabulary", "card", id] });
      await invalidate();
    },
  });
}

export function useCreateList() {
  const invalidate = useInvalidateVocabulary();
  return useMutation({
    mutationFn: (name: string) => createList(name),
    onSuccess: invalidate,
  });
}

export function useRenameList() {
  const invalidate = useInvalidateVocabulary();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      renameList(id, name),
    onSuccess: invalidate,
  });
}

export function useDeleteList() {
  const client = useQueryClient();
  const invalidate = useInvalidateVocabulary();

  return useMutation({
    mutationFn: (id: number) => deleteList(id),
    onSuccess: async () => {
      // Список міг бути позначений за замовчуванням — FK його обнулив, і кеш
      // налаштувань про це не знає.
      await client.invalidateQueries({ queryKey: ["study", "settings"] });
      await invalidate();
    },
  });
}

export { CARDS_PER_PAGE };
