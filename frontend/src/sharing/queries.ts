/**
 * Читання й записи шерингу.
 *
 * Офлайну тут немає навмисно: посилання, перегляд чужого списку й імпорт без
 * мережі не мають сенсу взагалі (ADR-0007 лишає офлайн навчанню). Тому ні
 * IndexedDB, ні буфера — лише TanStack Query.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchSharePreview,
  fetchSharedCards,
  importShare,
  shareList,
  unshareList,
  type ImportMode,
  type SharedCardPage,
} from "../api/sharing";

/** Стан посилання читається зі списків: `share_token` уже їде в `GET /lists/`. */
function useInvalidateLists() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["vocabulary", "lists"] });
}

export function useShareList() {
  const invalidate = useInvalidateLists();
  return useMutation({
    mutationFn: (listId: number) => shareList(listId),
    onSuccess: invalidate,
  });
}

export function useUnshareList() {
  const invalidate = useInvalidateLists();
  return useMutation({
    mutationFn: (listId: number) => unshareList(listId),
    onSuccess: invalidate,
  });
}

export function useSharePreview(token: string | undefined) {
  return useQuery({
    queryKey: ["share", token, "preview"],
    enabled: Boolean(token),
    queryFn: () => fetchSharePreview(token as string),
    // Перезапитувати не треба: чужий список між двома поглядами не змінюється
    // настільки, щоб це варте було запиту, а `already_have` залежить від твого
    // словника, який на цьому екрані не редагується.
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSharedCards(token: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["share", token, "cards"],
    enabled: Boolean(token),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      fetchSharedCards(token as string, pageParam as number, signal),
    // Той самий розрахунок, що у словнику: з `total`, а не з «прийшло рівно
    // per_page», інакше на кратній 50 кількості буде зайвий порожній запит.
    getNextPageParam: (last: SharedCardPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useImportShare(token: string | undefined) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ name, mode }: { name: string; mode: ImportMode }) =>
      importShare(token as string, name, mode),
    onSuccess: async () => {
      // Приїхали чужі картки й новий список — міняється весь словник. І
      // «Сьогодні» теж: імпортовані картки рахуються в денну ціль «додати
      // слова», бо вони справді з'явились у словнику того дня.
      await client.invalidateQueries({ queryKey: ["vocabulary"] });
      await client.invalidateQueries({ queryKey: ["study", "today"] });
    },
  });
}
