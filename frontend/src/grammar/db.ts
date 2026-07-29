/**
 * Офлайн-кеш граматики.
 *
 * Третя база, поруч зі `slovnuk-study` і `slovnuk-vocabulary`, і з тієї самої
 * причини: у базі навчання лежить `outbox` — відповіді, яких не відновити нічим,
 * і піднімати її версію заради кешу, що будь-коли перезавантажується, означало б
 * ризикувати незамінним заради замінного.
 *
 * На відміну від словника, тут кешується ВЕСЬ довідник, а не переглянуте.
 * Підстава — розмір: усі нотатки разом важать одиниці кілобайт проти 750 КБ
 * словника. Наслідок видно користувачу: граматика офлайн читається й шукається
 * цілком, тоді як у словнику пошук офлайн вимкнено.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CategoryPage } from "../api/grammar";
import type { Note } from "./note";

interface GrammarDb extends DBSchema {
  notes: { key: string; value: Note[] };
  categories: { key: string; value: CategoryPage };
}

const ALL = "all";

let dbPromise: Promise<IDBPDatabase<GrammarDb>> | null = null;

function db(): Promise<IDBPDatabase<GrammarDb>> {
  dbPromise ??= openDB<GrammarDb>("slovnuk-grammar", 1, {
    upgrade(database) {
      database.createObjectStore("notes");
      database.createObjectStore("categories");
    },
  });
  return dbPromise;
}

export async function readNotes(): Promise<Note[] | undefined> {
  try {
    return await (await db()).get("notes", ALL);
  } catch {
    // Приватний режим або заборонене сховище: працюємо без кешу, не падаємо.
    return undefined;
  }
}

export async function writeNotes(notes: Note[]): Promise<void> {
  try {
    await (await db()).put("notes", notes, ALL);
  } catch {
    /* кеш — не критичний шлях */
  }
}

export async function readCategories(): Promise<CategoryPage | undefined> {
  try {
    return await (await db()).get("categories", ALL);
  } catch {
    return undefined;
  }
}

export async function writeCategories(page: CategoryPage): Promise<void> {
  try {
    await (await db()).put("categories", page, ALL);
  } catch {
    /* те саме */
  }
}
