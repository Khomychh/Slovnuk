/**
 * Локальне сховище навчання.
 *
 * Одна база, три столи з різною політикою:
 *
 *   queue    — буфер карток. Втратили — не страшно, перезавантажиться з
 *              /study/queue/.
 *   outbox   — відповіді, які ще не доїхали. Втратили — БЕЗПОВОРОТНО: review_logs
 *              заднім числом не відновити, а синтезувати їх заборонено
 *              (CONTEXT.md, «Запис повторення»). Рядок звідси зникає ЛИШЕ після
 *              успішної відповіді сервера.
 *   snapshot — останнє відоме «Сьогодні», календар, денна дельта й налаштування,
 *              щоб екран не був порожнім при офлайн-відкритті (ADR-0007) і не
 *              брехав про вибір користувача (ADR-0014).
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { components } from "../api/schema";
import type { Progress, QueueItem, Rating } from "./session";

export type OutboxEntry = {
  trackId: number;
  rating: Rating;
  /**
   * Мілісекунди від показу картки до натискання оцінки.
   *
   * `null` означає «не виміряно» — так буває, коли картку правили просто під
   * час показу (ADR-0024). Нулем це підмінити не можна: нуль є числом і поїде
   * в оптимізатор як миттєве згадування.
   */
  reviewDuration: number | null;
  /** Час НАТИСКАННЯ, не доставки: саме він піде в review_logs.reviewed_at. */
  reviewedAt: string;
};

export type BufferRecord = {
  items: QueueItem[];
  dueCount: number;
  newCount: number;
  /** Списки й напрямок, за яких буфер набирався. Змінились — буфер недійсний. */
  filterKey: string;
  fetchedAt: string;
};

type TodayResponse = components["schemas"]["StudyDayResponseSchema"];
type DaysResponse = components["schemas"]["StudyDaysResponseSchema"];
type Settings = components["schemas"]["StudySettingsResponseSchema"];

interface StudyDb extends DBSchema {
  queue: { key: string; value: BufferRecord };
  outbox: { key: number; value: OutboxEntry };
  snapshot: {
    key: string;
    value: TodayResponse | DaysResponse | Progress | Settings | number[];
  };
}

const BUFFER_KEY = "buffer";

let dbPromise: Promise<IDBPDatabase<StudyDb>> | null = null;

function db(): Promise<IDBPDatabase<StudyDb>> {
  dbPromise ??= openDB<StudyDb>("slovnuk-study", 1, {
    upgrade(database) {
      database.createObjectStore("queue");
      database.createObjectStore("outbox", { autoIncrement: true });
      database.createObjectStore("snapshot");
    },
  });
  return dbPromise;
}

/**
 * Попросити браузер не викидати сховище під тиском місця.
 *
 * Один рядок, який рятує саме те, чого не відновити: невідправлені відповіді.
 * Без нього iOS має право почистити базу, і разом із нею піде історія повторень.
 * Відмова — не помилка: працюємо далі, просто без гарантії.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// --- буфер ---

export async function readBuffer(): Promise<BufferRecord | undefined> {
  return (await db()).get("queue", BUFFER_KEY);
}

export async function writeBuffer(record: BufferRecord): Promise<void> {
  await (await db()).put("queue", record, BUFFER_KEY);
}

export async function clearBuffer(): Promise<void> {
  await (await db()).delete("queue", BUFFER_KEY);
}

// --- черга відправки ---

export async function enqueueAnswer(entry: OutboxEntry): Promise<void> {
  await (await db()).add("outbox", entry);
}

/** Записи в порядку додавання — саме в ньому їх треба слати. */
export async function readOutbox(): Promise<
  { key: number; entry: OutboxEntry }[]
> {
  const store = (await db()).transaction("outbox").store;
  const out: { key: number; entry: OutboxEntry }[] = [];
  for (let cursor = await store.openCursor(); cursor; cursor = await cursor.continue()) {
    out.push({ key: cursor.primaryKey, entry: cursor.value });
  }
  return out;
}

export async function dropFromOutbox(key: number): Promise<void> {
  await (await db()).delete("outbox", key);
}

export async function outboxSize(): Promise<number> {
  return (await db()).count("outbox");
}

/** Які доріжки чекають на відправку — щоб не втягнути їх у буфер удруге. */
export async function pendingTrackIds(): Promise<number[]> {
  return (await readOutbox()).map(({ entry }) => entry.trackId);
}

// --- знімки ---

export async function readToday(): Promise<TodayResponse | undefined> {
  return (await db()).get("snapshot", "today") as Promise<TodayResponse | undefined>;
}

export async function writeToday(value: TodayResponse): Promise<void> {
  await (await db()).put("snapshot", value, "today");
}

export async function readDays(): Promise<DaysResponse | undefined> {
  return (await db()).get("snapshot", "days") as Promise<DaysResponse | undefined>;
}

export async function writeDays(value: DaysResponse): Promise<void> {
  await (await db()).put("snapshot", value, "days");
}

export async function readProgress(): Promise<Progress | undefined> {
  return (await db()).get("snapshot", "progress") as Promise<Progress | undefined>;
}

export async function writeProgress(value: Progress): Promise<void> {
  await (await db()).put("snapshot", value, "progress");
}

/**
 * Налаштування навчання — останні відомі.
 *
 * Без цього дзеркала офлайн діяли б дефолти коду, а не вибір користувача, і
 * застосунок тихо брехав би про нього двічі: напрямок «укр → англ» ставав би
 * «англ → укр», а вимкнене озвучення — увімкненим, тобто телефон заговорив би
 * там, де його свідомо змусили мовчати. Причини й альтернативи — в ADR-0014.
 */
export async function readSettings(): Promise<Settings | undefined> {
  return (await db()).get("snapshot", "settings") as Promise<Settings | undefined>;
}

export async function writeSettings(value: Settings): Promise<void> {
  await (await db()).put("snapshot", value, "settings");
}

/**
 * Обрані списки.
 *
 * Живуть тільки на клієнті: це не налаштування користувача, а «що я вчу зараз».
 * Порожній масив означає «усі списки», а не «жодного» — тому й зберігається
 * саме масив, а не прапорець.
 */
export async function readListFilter(): Promise<number[]> {
  return ((await (await db()).get("snapshot", "filter")) as number[]) ?? [];
}

export async function writeListFilter(listIds: number[]): Promise<void> {
  await (await db()).put("snapshot", listIds, "filter");
}
