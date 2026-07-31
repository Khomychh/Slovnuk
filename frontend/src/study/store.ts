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
import {
  fetchQueue,
  postReview,
  type TodayResponse,
  type DaysResponse,
  type StudySettings,
} from "../api/study";
import * as db from "./db";
import { localDay, resolveTimeZone, type DayKey } from "./day";
import {
  aimKey,
  applyCardEdit,
  applyRating,
  countAnswer,
  dropCard,
  emptyProgress,
  EMPTY_AIM,
  mergeIncoming,
  sameAim,
  syncProgress,
  type Aim,
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
  /** Вибір груп — звідки береться черга. Порожній означає «усі слова». */
  aim: Aim;
  /**
   * Вибір щойно перевели, і скільки там тепер — ще невідомо.
   *
   * Без цього прапорця в стані було два значення на три випадки: «рахую»
   * (`refilling`) і «нічого немає» (лічильники по нулях). Мить між дотиком по
   * рядку й відповіддю сервера потрапляла в друге — і екран казав «Все
   * повторено» рівно тоді, коли людина дивилась, що ж вона щойно вибрала.
   */
  aimCounting: boolean;
  /** Останнє відоме «Сьогодні» — щоб офлайн-відкриття не показувало порожнечу. */
  snapshotToday: TodayResponse | null;
  snapshotDays: DaysResponse | null;
  /**
   * Останні відомі налаштування.
   *
   * Не кеш заради швидкості, а захист від брехні: без них офлайн діяли б
   * дефолти коду замість вибору користувача (ADR-0014). Читає їх `useSettings`,
   * тому знати про це поле екранам не треба.
   */
  snapshotSettings: StudySettings | null;
  refilling: boolean;
  /** Зерно розкладу боків при напрямку «змішано». Нове на кожну сесію. */
  seed: number;
};

let state: StudyState = {
  ready: false,
  buffer: [],
  dueCount: 0,
  newCount: 0,
  pending: 0,
  progress: emptyProgress(localDay(new Date(), "UTC")),
  aim: EMPTY_AIM,
  aimCounting: false,
  snapshotToday: null,
  snapshotDays: null,
  snapshotSettings: null,
  refilling: false,
  seed: 1,
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

    const [
      aim,
      buffer,
      progress,
      snapshotToday,
      snapshotDays,
      snapshotSettings,
      pending,
    ] = await Promise.all([
      db.readListFilter(),
      db.readBuffer(),
      db.readProgress(),
      db.readToday(),
      db.readDays(),
      db.readSettings(),
      db.outboxSize(),
    ]);

    const day = today();
    const usable = buffer && buffer.filterKey === aimKey(aim);

    set({
      ready: true,
      aim,
      buffer: usable ? buffer.items : [],
      dueCount: usable ? buffer.dueCount : 0,
      newCount: usable ? buffer.newCount : 0,
      // Дельта, що пережила перехід доби, до сьогоднішнього дня не стосується.
      progress: progress && progress.day === day ? progress : emptyProgress(day),
      snapshotToday: snapshotToday ?? null,
      snapshotDays: snapshotDays ?? null,
      snapshotSettings: snapshotSettings ?? null,
      pending,
    });

    // Пояс із дзеркала потрібен ще до першої вдалої відповіді сервера: без
    // нього доба рахувалась би в UTC, і нічне повторення потрапило б не в той
    // день. Мережа уточнить це пізніше тим самим значенням.
    if (snapshotSettings) setTimeZone(resolveTimeZone(snapshotSettings.timezone));

    if (!usable) await db.clearBuffer();
    void flush();
  })();
  return initPromise;
}

// --- вибір груп ---

/** Скільки чекати після останнього дотику, перш ніж питати «скільки їх тепер». */
const AIM_SETTLE_MS = 500;

let aimTimer: ReturnType<typeof setTimeout> | null = null;
let aimProbe: AbortController | null = null;

/** Забути про відкладене питання «скільки» — його або вже не треба, або пізно. */
function cancelProbe(): void {
  if (aimTimer !== null) clearTimeout(aimTimer);
  aimTimer = null;
  aimProbe?.abort();
  aimProbe = null;
}

/**
 * Змінити вибір груп.
 *
 * Картки тут НЕ запитуються, і це навмисно. Вибір переводять дотиками по
 * рядках — вибрав три списки, передумав, зняв один. Повна вибірка на кожен
 * дотик означала б чотири порції по 50 карток, з яких три викидаються, не
 * доїхавши. Порція приїжджає раз, у `aimSettled`.
 *
 * А от лічильники питаються, бо кнопка «Вчити» стоїть просто над панеллю і
 * мусить говорити про той вибір, який зараз на екрані. Питаються з паузою після
 * останнього дотику й без карток (`limit=0`) — три перекинуті думки коштують
 * одного запиту за двома числами, а не трьох вибірок.
 *
 * Буфер скидається одразу: показувати картки зі списків, які вже не обрані,
 * гірше, ніж не показувати нічого.
 */
export async function setAim(aim: Aim): Promise<void> {
  if (sameAim(aim, state.aim)) return;
  cancelProbe();
  await db.writeListFilter(aim);
  await db.clearBuffer();
  // Офлайн лічильників не буде, і чесніше сказати нуль, ніж вічно «Рахую…».
  // Самі рядки вибору офлайн і так недоступні — це запобіжник, не сценарій.
  const online = navigator.onLine;
  set({ aim, buffer: [], dueCount: 0, newCount: 0, aimCounting: online });
  if (!online) return;
  aimTimer = setTimeout(() => void probeAim(), AIM_SETTLE_MS);
}

/**
 * Спитати самі лічильники нового вибору.
 *
 * Відповідь на давній вибір відкидається: поки два числа летіли, рядки могли
 * перевести ще раз, і показати ці числа означало б відповісти на позавчорашнє
 * питання.
 */
async function probeAim(): Promise<void> {
  aimTimer = null;
  const controller = new AbortController();
  aimProbe = controller;
  const asked = aimKey(state.aim);

  try {
    const response = await fetchQueue(state.aim, 0, controller.signal);
    if (aimKey(state.aim) !== asked) return;
    set({
      dueCount: response.due_count,
      newCount: response.new_count,
      aimCounting: false,
    });
  } catch {
    // Скасували новим дотиком — про це подбає той дотик. Зникла мережа — про це
    // скаже прапорець офлайну. Обидва випадки лишають екран без «Рахую…».
    if (aimKey(state.aim) === asked) set({ aimCounting: false });
  } finally {
    if (aimProbe === controller) aimProbe = null;
  }
}

/**
 * Вибирати закінчили — піти по саму чергу.
 *
 * Викликається на згортання панелі, а не на зміну вибору. Це і є те «Готово»,
 * якого немає на екрані: кнопки не треба, бо згорнути панель і означає, що
 * людина закінчила вибирати.
 *
 * Без цього виклику лічильники були б, а карток — ні: `setAim` чистить буфер,
 * а `probeAim` навмисно нічим його не наповнює.
 */
export async function aimSettled(): Promise<void> {
  // Пауза після останнього дотику вже не потрібна: повна вибірка привезе ті
  // самі два числа разом із картками.
  cancelProbe();
  if (state.aimCounting) set({ aimCounting: false });
  if (state.buffer.length > 0 || !navigator.onLine) return;
  await refill().catch(() => {
    /* мережа могла зникнути між згортанням і запитом — екран скаже про офлайн */
  });
}

// --- поповнення буфера ---

async function persistBuffer(): Promise<void> {
  await db.writeBuffer({
    items: state.buffer,
    dueCount: state.dueCount,
    newCount: state.newCount,
    filterKey: aimKey(state.aim),
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
    const response = await fetchQueue(state.aim, QUEUE_LIMIT);
    const pending = await db.pendingTrackIds();
    set({
      buffer: mergeIncoming(state.buffer, response.items, pending),
      dueCount: response.due_count,
      newCount: response.new_count,
      // Повна вибірка відповідає на те саме питання, що й `probeAim`, тільки
      // ще й картками. Чекати після неї нема на що.
      aimCounting: false,
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

/**
 * Картку виправили просто під час показу — вкласти новий вміст у буфер.
 *
 * Лічильники черги (`dueCount`, `newCount`) свідомо не чіпаються: правка тексту
 * не міняє того, скільки доріжок настав час показати. Виняток — зникла доріжка
 * форм, але брехати про це на одиницю до наступної вибірки дешевше, ніж вести
 * тут власну арифметику поруч із серверною.
 */
export async function cardEdited(
  card: QueueItem["card"] & { forms_drill_enabled: boolean },
): Promise<void> {
  set({ buffer: applyCardEdit(state.buffer, card) });
  await persistBuffer();
}

/** Картку видалили з навчання — прибрати обидві її доріжки з буфера. */
export async function cardDeleted(cardId: number): Promise<void> {
  set({ buffer: dropCard(state.buffer, cardId) });
  await persistBuffer();
  // Буфер міг спорожніти на цьому — доллємо, поки людина ще в навчанні.
  await refillIfLow();
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
  /** `null` — час не виміряно, бо картку правили під час показу (ADR-0024). */
  reviewDuration: number | null,
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
          // Відповідь сервера свідомо не читається: усе, що з неї бралось, —
          // це `due_at` для підпису інтервалу, а підпису більше немає
          // (ADR-0009). Значення має сам факт, що запис доїхав.
          await postReview(entry.trackId, entry.rating, entry.reviewDuration);
          await db.dropFromOutbox(key);
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

/**
 * Прийняти налаштування — і від сервера, і від власної мутації.
 *
 * Викликати треба в обох випадках, інакше дзеркало тихо застаріє: користувач
 * вимкнув озвучення, `PATCH` пройшов, а в сховищі лишилось «увімкнено» — і
 * рівно до наступного вдалого читання застосунок офлайн говорив би всупереч
 * щойно зробленому вибору.
 */
export async function acceptSettings(value: StudySettings): Promise<void> {
  set({ snapshotSettings: value });
  setTimeZone(resolveTimeZone(value.timezone));
  await db.writeSettings(value);
}

// --- поява звʼязку ---

if (typeof window !== "undefined") {
  // Звʼязок зʼявився — розсмоктуємо чергу. Не чекаємо на дію користувача:
  // відповіді мають доїхати, навіть якщо він більше сьогодні не вчиться.
  window.addEventListener("online", () => void flush());
}
