/**
 * Офлайн-кеш словника.
 *
 * Окрема база, а не четвертий стіл у `slovnuk-study`, і це навмисно: там лежить
 * `outbox` — відповіді, яких не відновити нічим. Піднімати версію тієї бази
 * заради кешу, який будь-коли можна перезавантажити, означало б ризикувати
 * незамінним заради замінного.
 *
 * Кешується лише те, що користувач справді відкривав (ADR-0007 + рішення блоку
 * 3). Весь словник не кешуємо: пошук серверний, тож повний кеш вимагав би
 * другої, локальної реалізації пошуку — рівно тієї подвійної реалізації, якої
 * ADR-0007 уникає для планувальника.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CardPage, WordListPage } from "../api/vocabulary";

interface VocabularyDb extends DBSchema {
  /** Ключ — рядок фільтра плюс номер сторінки. */
  pages: { key: string; value: CardPage };
  lists: { key: string; value: WordListPage };
}

let dbPromise: Promise<IDBPDatabase<VocabularyDb>> | null = null;

function db(): Promise<IDBPDatabase<VocabularyDb>> {
  dbPromise ??= openDB<VocabularyDb>("slovnuk-vocabulary", 1, {
    upgrade(database) {
      database.createObjectStore("pages");
      database.createObjectStore("lists");
    },
  });
  return dbPromise;
}

export async function readPage(key: string): Promise<CardPage | undefined> {
  try {
    return await (await db()).get("pages", key);
  } catch {
    // Приватний режим або заборонене сховище: працюємо без кешу, не падаємо.
    return undefined;
  }
}

export async function writePage(key: string, value: CardPage): Promise<void> {
  try {
    await (await db()).put("pages", value, key);
  } catch {
    /* кеш — не критичний шлях */
  }
}

export async function readLists(): Promise<WordListPage | undefined> {
  try {
    return await (await db()).get("lists", "lists");
  } catch {
    return undefined;
  }
}

export async function writeLists(value: WordListPage): Promise<void> {
  try {
    await (await db()).put("lists", value, "lists");
  } catch {
    /* те саме */
  }
}

/**
 * Кеш сторінок після зміни словника.
 *
 * Викидається все: картка могла зникнути з першої сторінки й зсунути решту, а
 * тримати частково правдивий кеш гірше, ніж не тримати жодного — його ж
 * показують саме тоді, коли перевірити нічим.
 */
export async function dropPages(): Promise<void> {
  try {
    await (await db()).clear("pages");
  } catch {
    /* те саме */
  }
}
