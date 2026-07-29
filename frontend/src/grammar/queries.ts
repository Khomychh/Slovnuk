/**
 * Серверні читання й записи граматики.
 *
 * Простіше за словник: жодної пагінації в стані, жодного буфера. Довідник
 * приїжджає цілком одним запитом, лягає в IndexedDB і далі фільтрується на
 * клієнті — тож пошук і вибір розділу не коштують мережі взагалі.
 */

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createNote,
  deleteCategory,
  deleteNote,
  fetchAllNotes,
  fetchCategories,
  renameCategory,
  updateNote,
  type NotePayload,
} from "../api/grammar";
import { readCategories, readNotes, writeCategories, writeNotes } from "./db";

export function useNotes() {
  return useQuery({
    queryKey: ["grammar", "notes"],
    queryFn: async ({ signal }) => {
      try {
        const notes = await fetchAllNotes(signal);
        void writeNotes(notes);
        return notes;
      } catch (error) {
        // Офлайн — віддаємо збережений довідник. Тут це повноцінне читання, а
        // не уламок: кешується все, а не переглянуте.
        const cached = await readNotes();
        if (cached) return cached;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["grammar", "categories"],
    queryFn: async () => {
      try {
        const page = await fetchCategories();
        void writeCategories(page);
        return page;
      } catch (error) {
        const cached = await readCategories();
        if (cached) return cached;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

/**
 * Скинути все, на що впливає зміна нотатки.
 *
 * Розділи теж, і не лише через лічильники: розділ заводиться САМОЮ назвою в
 * редакторі, тож збереження нотатки могло щойно створити розділ, якого в кеші
 * ще немає.
 */
function useInvalidateGrammar() {
  const client = useQueryClient();
  return useCallback(
    () => client.invalidateQueries({ queryKey: ["grammar"] }),
    [client],
  );
}

export function useCreateNote() {
  const invalidate = useInvalidateGrammar();
  return useMutation({
    mutationFn: (payload: NotePayload) => createNote(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateNote() {
  const invalidate = useInvalidateGrammar();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: NotePayload }) =>
      updateNote(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteNote() {
  const invalidate = useInvalidateGrammar();
  return useMutation({
    mutationFn: (id: number) => deleteNote(id),
    onSuccess: invalidate,
  });
}

export function useRenameCategory() {
  const invalidate = useInvalidateGrammar();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      renameCategory(id, name),
    // Нотатки теж: у кожній лежить `category_name`, і без скидання перейменований
    // розділ показувався б старою назвою в чипах списку.
    onSuccess: invalidate,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateGrammar();
  return useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: invalidate,
  });
}
