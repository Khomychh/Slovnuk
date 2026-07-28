/**
 * Стан навчання: буфер карток, черга відправки, денний лічильник.
 *
 * Це НЕ кеш серверної відповіді. Буфер стоїть між екраном і мережею постійно
 * (ADR-0010): `GET /study/queue/` ніколи не малюється напряму, він лише
 * домішується сюди, а порядок показу вирішує локальне правило з `session.ts`.
 * Тому цей стан і не живе в TanStack Query — Query відповідає за читання, які
 * має право перезапитати, а тут перезапитувати нічого: до синхронізації це і є
 * правда.
 *
 * Уся логіка з розгалуженнями винесена в `session.ts` і накрита Vitest. Тут
 * лишились мережа, IndexedDB і підписка — те, що перевіряється живим браузером.
 */

import { ApiError, OfflineError } from "../api/client";
import { fetchQueue, postReview, type TodayResponse, type DaysResponse } from "../api/study";
import * as db from "./db";
import { localDay, type DayKey } from "./day";
import {
  applyRating,
  countAnswer,
  emptyProgress,
  mergeIncoming,
  syncProgress,
  type Progress,
  type QueueItem,
  type Rating,
} from "./session";

/** Скільки карток має лишитись у буфері, щоб почати доливати наступні. */
const REFILL_AT = 10;
const QUEUE_LIMIT = 50;

export type StudyState = {
  /** Поки false, екран навчання не має чого показувати — база ще відкривається. */
  ready: boolean;
  buffer: QueueItem[];
  /** Лічильники всієї черги з останньої вдалої вибірки, а не довжина буфера. */
  dueCount: number;
  newCount: number;
  /** Скільки відповідей чекають на відправку. */
  pending: number;
  progress: Progress;
  listFilter: number[];
  /** Останнє відоме «Сьогодні» — щоб офлайн-відкриття не показувало порожнечу. */
  snapshotToday: TodayResponse | null;
  snapshotDays: DaysResponse | null;
  refilling: boolean;
  /** Зерно розкладу боків при напрямку «змішано». Нове на кожну сесію. */
  seed: number;
  /**
   * Останній факт від сервера: коли доріжку справді призначено показати.
   *
   * Потрібен підпису під карткою. Прогноз із `preview` зʼявляється миттєво на
   * натисканні, але він рахується без фазі й від моменту видачі черги, тож із
   * фактом не збігається (ADR-0009). Щойно відповідь доїхала — підпис
   * уточнюється справжнім `due_at`.
   */
  lastReview: { trackId: number; dueAt: string } | null;
};

let state: StudyState = {
  ready: false,
  buffer: [],
  dueCount: 0,
  newCount: 0,
  pending: 0,
  progress: emptyProgress(localDay(new Date(), "UTC")),
  listFilter: [],
  snapshotToday: null,
  snapshotDays: null,
  refilling: false,
  seed: 1,
  lastReview: null,
};

let timeZone = "UTC";
const listeners = new Set<() => void>();

function set(patch: Partial<StudyState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): StudyState {
  return state;
}

/** Пояс потрібен лише для однієї речі — визначити, яка зараз доба. */
export function setTimeZone(name: string): void {
  timeZone = name;
}

function today(): DayKey {
  return localDay(new Date(), timeZone);
}

function filterKeyOf(listIds: number[]): string {
  return [...listIds].sort((a, b) => a - b).join(",");
}

// --- запуск ---

let initPromise: Promise<void> | null = null;

/**
 * Прочитати все, що пережило перезапуск.
 *
 * Буфер зі старим фільтром викидається: показувати картки зі списків, які вже
 * не обрані, гірше, ніж не показувати нічого.
 */
export function init(): Promise<void> {
  initPromise ??= (async () => {
    void db.requestPersistence();

    const [listFilter, buffer, progress, snapshotToday, snapshotDays, pending] =
      await Promise.all([
        db.readListFilter(),
        db.readBuffer(),
        db.readProgress(),
        db.readToday(),
        db.readDays(),
        db.outboxSize(),
      ]);

    const day = today();
    const usable = buffer && buffer.filterKey === filterKeyOf(listFilter);

    set({
      ready: true,
      listFilter,
      buffer: usable ? buffer.items : [],
      dueCount: usable ? buffer.dueCount : 0,
      newCount: usable ? buffer.newCount : 0,
      // Дельта, що пережила перехід доби, до сьогоднішнього дня не стосується.
      progress: progress && progress.day === day ? progress : emptyProgress(day),
      snapshotToday: snapshotToday ?? null,
      snapshotDays: snapshotDays ?? null,
      pending,
    });

    if (!usable) await db.clearBuffer();
    void flush();
  })();
  return initPromise;
}

// --- фільтр списків ---

export async function setListFilter(listIds: number[]): Promise<void> {
  if (filterKeyOf(listIds) === filterKeyOf(state.listFilter)) return;
  await db.writeListFilter(listIds);
  await db.clearBuffer();
  // Буфер набирався за інших умов — усе, що в ньому лежить, більше не підходить.
  set({ listFilter: listIds, buffer: [], dueCount: 0, newCount: 0 });
}

// --- поповнення буфера ---

async function persistBuffer(): Promise<void> {
  await db.writeBuffer({
    items: state.buffer,
    dueCount: state.dueCount,
    newCount: state.newCount,
    filterKey: filterKeyOf(state.listFilter),
    fetchedAt: new Date().toISOString(),
  });
}

/**
 * Долити буфер зі свіжої вибірки.
 *
 * Мовчки нічого не робить без мережі: це не помилка, а звичайний стан
 * застосунку, який вчить у метро. Помилку показує екран — по прапорцю офлайну.
 */
export async function refill(): Promise<void> {
  if (state.refilling) return;
  set({ refilling: true });
  try {
    const response = await fetchQueue(state.listFilter, QUEUE_LIMIT);
    const pending = await db.pendingTrackIds();
    set({
      buffer: mergeIncoming(state.buffer, response.items, pending),
      dueCount: response.due_count,
      newCount: response.new_count,
    });
    await persistBuffer();
  } catch (error) {
    if (!(error instanceof OfflineError)) throw error;
  } finally {
    set({ refilling: false });
  }
}

/** Долити, якщо буфер закінчується. Викликається після кожної відповіді. */
async function refillIfLow(): Promise<void> {
  if (state.buffer.length > REFILL_AT || !navigator.onLine) return;
  await refill().catch(() => {
    /* поповнення — не критична дія: у буфері ще щось є */
  });
}

/** Нова сесія: інше зерно розкладу боків і свіжа вибірка. */
export async function beginSession(): Promise<void> {
  set({ seed: Math.floor(Math.random() * 2 ** 31) });
  await refill().catch(() => {});
}

// --- відповідь ---

/**
 * Оцінити картку, що стоїть першою в буфері.
 *
 * Порядок дій навмисний: спершу відповідь лягає в чергу відправки, і лише потім
 * міняється буфер. Якщо застосунок помре між цими двома кроками, картка
 * покажеться вдруге — прикро, але не страшно. Зворотний порядок утратив би саму
 * відповідь, а її не відновити нічим.
 */
export async function answer(
  trackId: number,
  rating: Rating,
  reviewDuration: number,
): Promise<void> {
  const day = today();

  await db.enqueueAnswer({
    trackId,
    rating,
    reviewDuration,
    // Час натискання, а не доставки: саме він піде в review_logs.reviewed_at,
    // інакше оптимізатор побачить вигадану історію (ADR-0007).
    reviewedAt: new Date().toISOString(),
  });

  const progress = countAnswer(state.progress, trackId, day);
  set({
    buffer: applyRating(state.buffer, rating),
    progress,
    pending: state.pending + 1,
  });

  await Promise.all([persistBuffer(), db.writeProgress(progress)]);

  void flush().then(refillIfLow);
}

// --- відправка ---

let flushing: Promise<void> | null = null;

/**
 * Віддати серверу все, що назбиралось, у порядку натискань.
 *
 * Дві відповіді на одну доріжку конфліктом не є: сервер застосує їх послідовно,
 * і для FSRS це справді дві відповіді (ADR-0007). Тому порядок важливий, і
 * відправка йде по одній, а не паралельно.
 */
export function flush(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (const { key, entry } of await db.readOutbox()) {
        try {
          const result = await postReview(
            entry.trackId,
            entry.rating,
            entry.reviewDuration,
          );
          await db.dropFromOutbox(key);
          set({ lastReview: { trackId: entry.trackId, dueAt: result.due_at } });
        } catch (error) {
          if (isPermanent(error)) {
            // Ця відповідь не доїде ніколи: доріжки вже немає. Тримати її в
            // черзі означало б заклинити всі наступні.
            await db.dropFromOutbox(key);
            continue;
          }
          // Мережа, 5xx або мертва сесія — спробуємо ще раз пізніше. Решта
          // черги лишається на місці, порядок не ламається.
          return;
        }
      }
    } finally {
      set({ pending: await db.outboxSize() });
      flushing = null;
    }
  })();
  return flushing;
}

/**
 * Чи має сенс повторювати цю відповідь.
 *
 * 404 — доріжку видалили разом із карткою (ADR-0003), і сервер її не прийме вже
 * ніколи. 422 — тіло запиту не пройде валідацію й наступного разу. Все інше,
 * зокрема 401 і 5xx, — тимчасове.
 */
function isPermanent(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 422);
}

// --- знімки серверних читань ---

/**
 * Прийняти свіже «Сьогодні».
 *
 * Локальна дельта скидається ЛИШЕ коли черга відправки порожня. Інакше сервер
 * ще не порахував надіслані відповіді, а дельта вже обнулена — і лічильник
 * стрибне назад на очах у користувача.
 */
export async function acceptToday(value: TodayResponse): Promise<void> {
  const patch: Partial<StudyState> = { snapshotToday: value };
  if (state.pending === 0) {
    const progress = syncProgress(value.reviews_done, today());
    patch.progress = progress;
    await db.writeProgress(progress);
  }
  set(patch);
  await db.writeToday(value);
}

export async function acceptDays(value: DaysResponse): Promise<void> {
  set({ snapshotDays: value });
  await db.writeDays(value);
}

// --- поява звʼязку ---

if (typeof window !== "undefined") {
  // Звʼязок зʼявився — розсмоктуємо чергу. Не чекаємо на дію користувача:
  // відповіді мають доїхати, навіть якщо він більше сьогодні не вчиться.
  window.addEventListener("online", () => void flush());
}
