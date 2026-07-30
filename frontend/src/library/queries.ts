/**
 * Читання й записи Бібліотеки.
 *
 * Офлайну тут немає навмисно: витрина, чужий список і взяття без мережі не мають
 * сенсу взагалі (ADR-0007 лишає офлайн навчанню). Ні IndexedDB, ні буфера — лише
 * TanStack Query.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchLibrary,
  fetchListPublication,
  fetchPublication,
  fetchPublicationCards,
  publishList,
  ratePublication,
  refreshPublication,
  reportPublication,
  takePublication,
  unpublishList,
  type LibraryPage,
  type LibrarySort,
  type ReportReason,
  type SnapshotCardPage,
} from "../api/library";

export function useLibrary(sort: LibrarySort, q: string) {
  return useInfiniteQuery({
    // Порядок і пошук — частина ключа: інакше зміна сортування показувала б
    // сторінки, набрані в іншому порядку, доки не приїде перша нова.
    queryKey: ["library", "list", sort, q.trim()],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      fetchLibrary(pageParam as number, sort, q, signal),
    // Той самий розрахунок, що у словнику: з `total`, а не з «прийшло рівно
    // per_page», інакше на кратній кількості буде зайвий порожній запит.
    getNextPageParam: (last: LibraryPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
    // Коротше за шер: витрина живе чужими діями, і взяття з оцінками на ній
    // рухаються без участі цього браузера.
    staleTime: 60_000,
    retry: false,
  });
}

export function usePublication(id: number | undefined) {
  return useQuery({
    queryKey: ["library", "publication", id],
    enabled: Boolean(id),
    queryFn: () => fetchPublication(id as number),
    // `new_cards` залежить від ТВОГО словника, а він міняється поза цим
    // екраном — тож кешувати надовго тут не можна.
    staleTime: 30_000,
    retry: false,
  });
}

export function usePublicationCards(id: number | undefined) {
  return useInfiniteQuery({
    queryKey: ["library", "publication", id, "cards"],
    enabled: Boolean(id),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      fetchPublicationCards(id as number, pageParam as number, signal),
    getNextPageParam: (last: SnapshotCardPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
    // Знімок незмінний, доки автор не натисне «Оновити», — на відміну від
    // `already_have`, який залежить від твого словника. Тому сторінки живуть
    // довго, а їхній `already_have` освіжається разом із публікацією.
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useTakePublication(id: number | undefined) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => takePublication(id as number, name),
    onSuccess: async () => {
      // Приїхали чужі картки й новий список — міняється весь словник. І
      // «Сьогодні» теж: узяті картки рахуються в денну ціль «додати слова», бо
      // вони справді з'явились у словнику того дня.
      await client.invalidateQueries({ queryKey: ["vocabulary"] });
      await client.invalidateQueries({ queryKey: ["study", "today"] });
      // Витрина мусить показати «взято ✓», а сторінка — право на зірки.
      await client.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useRatePublication(id: number | undefined) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (stars: number) => ratePublication(id as number, stars),
    onSuccess: async () => {
      // Оцінка міняє і рейтинг публікації, і її місце в сортуванні «за
      // рейтингом» — тобто всю витрину, а не лише цей рядок.
      await client.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useReportPublication(id: number | undefined) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (reason: ReportReason) => reportPublication(id as number, reason),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["library", "publication", id] });
    },
  });
}

// --------------------------------------------------------------------------
// Власник
// --------------------------------------------------------------------------

/**
 * Публікація цього списку.
 *
 * 404 тут — нормальний стан «список не опубліковано», а не помилка. Тому
 * `retry: false` і перевірка статусу лежить на екрані: TanStack не має способу
 * сказати «немає» інакше, ніж помилкою.
 */
export function useListPublication(listId: number | undefined) {
  return useQuery({
    queryKey: ["library", "own", listId],
    enabled: Boolean(listId),
    queryFn: () => fetchListPublication(listId as number),
    staleTime: 30_000,
    retry: false,
  });
}

function useInvalidateOwn(listId: number | undefined) {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({ queryKey: ["library", "own", listId] });
    // Витрина міняється теж: публікація на ній з'явилась, зникла або
    // перейменувалась.
    await client.invalidateQueries({ queryKey: ["library", "list"] });
    // Рядок списку показує, чи він опублікований.
    await client.invalidateQueries({ queryKey: ["vocabulary", "lists"] });
  };
}

export function usePublishList(listId: number | undefined) {
  const invalidate = useInvalidateOwn(listId);
  return useMutation({
    mutationFn: ({ title, description }: { title: string; description: string | null }) =>
      publishList(listId as number, title, description),
    onSuccess: invalidate,
  });
}

export function useRefreshPublication(listId: number | undefined) {
  const invalidate = useInvalidateOwn(listId);
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => refreshPublication(listId as number),
    onSuccess: async () => {
      await invalidate();
      // Знімок замінився — сторінки слів публікації в кеші тепер від старого
      // вмісту. Ключа публікації тут немає (власник знає лише list_id), тож
      // скидаємо всі сторінки слів: їх у кеші щонайбільше кілька.
      await client.invalidateQueries({ queryKey: ["library", "publication"] });
    },
  });
}

export function useUnpublishList(listId: number | undefined) {
  const invalidate = useInvalidateOwn(listId);
  return useMutation({
    mutationFn: () => unpublishList(listId as number),
    onSuccess: invalidate,
  });
}
