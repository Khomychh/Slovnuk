/**
 * Локальне правило показу і денний лічильник — уся чиста логіка навчання.
 *
 * Тут немає ні мережі, ні IndexedDB, ні React: усе, що нижче, — функції над
 * простими значеннями. Саме це накриває Vitest, і саме це найлегше зламати
 * непомітно.
 *
 * Межа, яку не можна розмивати (ADR-0007): правило вирішує ЛИШЕ те, що
 * зʼявиться на екрані в найближчі хвилини. Стан доріжки — stability,
 * difficulty, state, due_at — рахує виключно сервер зі стрічки надісланих
 * відповідей. Спокуса дописати сюди `ts-fsrs` виникне; не треба.
 */

import type { components } from "../api/schema";
import type { DayKey } from "./day";

export type QueueItem = components["schemas"]["QueueItemSchema"];

/** 1 = Не згадав, 2 = Важко, 3 = Добре, 4 = Легко. Ті самі числа, що в API. */
export type Rating = 1 | 2 | 3 | 4;

/**
 * Вибір груп — звідки береться черга.
 *
 * Дві частини, а не один масив, бо «Без списку» списком не є: у нього немає
 * id, яким його можна було б покласти поруч із рештою. Підмінити його
 * сентинелом на кшталт `0` спокусливо рівно доти, доки цей нуль не поїде в
 * `?list_ids=0` і сервер не почне шукати список із таким номером.
 *
 * Порожній вибір (ні списків, ні прапорця) означає «усі слова», а не
 * «жодного»: фільтра просто немає.
 */
export type Aim = {
  listIds: number[];
  unlisted: boolean;
};

export const EMPTY_AIM: Aim = { listIds: [], unlisted: false };

/** Чи звужено вибір до конкретних груп. */
export function aimIsAll(aim: Aim): boolean {
  return aim.listIds.length === 0 && !aim.unlisted;
}

/**
 * Стала подоба вибору — нею звіряють, чи буфер ще годиться.
 *
 * Порядок id нормалізується: «Фрази, потім IELTS» і «IELTS, потім Фрази» — це
 * той самий вибір, і викидати через них повний буфер було б безпідставно.
 */
export function aimKey(aim: Aim): string {
  return `${[...aim.listIds].sort((a, b) => a - b).join(",")}|${aim.unlisted ? "u" : ""}`;
}

export function sameAim(a: Aim, b: Aim): boolean {
  return aimKey(a) === aimKey(b);
}

/**
 * Через скільки інших карток повертається забуте слово.
 *
 * Число взяте з ADR-0007 і ні на що, крім найближчих хвилин, не впливає —
 * міняти його можна без узгодження з бекендом.
 */
export const AGAIN_GAP = 3;

/**
 * Відповідь на картку, що стоїть першою в буфері.
 *
 * Повертає новий буфер; вхідний не змінюється.
 *
 * Окремий випадок: у буфері лишилась одна картка і її забули. Тоді вона
 * показується знову одразу — інших карток просто немає, а завершити навчання
 * на слові, яке щойно не згадали, гірше. Старий PWA поводився так само
 * (`session.push(item)` при довжині 1).
 */
export function applyRating(buffer: QueueItem[], rating: Rating): QueueItem[] {
  const answered = buffer[0];
  if (!answered) return buffer;
  const rest = buffer.slice(1);

  if (rating >= 3) return rest; // «Добре» і «Легко» — на сьогодні прибрати

  if (rating === 2) return [...rest, answered]; // «Важко» — наприкінці буфера

  // «Не згадав» — через AGAIN_GAP інших карток. Якщо їх стільки немає, картка
  // йде в кінець: вставляти «через три» в буфер із двох немає куди.
  if (rest.length <= AGAIN_GAP) return [...rest, answered];
  return [...rest.slice(0, AGAIN_GAP), answered, ...rest.slice(AGAIN_GAP)];
}

/**
 * Домішати свіжу вибірку з сервера в наявний буфер.
 *
 * Дедуплікація обовʼязкова (ADR-0010): вибірка принесе і те, що вже лежить у
 * буфері, і те, відповідь на що ще не доїхала до сервера, — а отже, і далі
 * виглядає для нього простроченим. Без цього одна картка зʼявилась би в сесії
 * двічі.
 *
 * Наявний порядок не чіпається: локальне правило вже щось про нього вирішило,
 * і свіжа вибірка не має права це переставляти.
 */
export function mergeIncoming(
  buffer: QueueItem[],
  incoming: QueueItem[],
  pendingTrackIds: Iterable<number> = [],
): QueueItem[] {
  const known = new Set(buffer.map((item) => item.track_id));
  for (const trackId of pendingTrackIds) known.add(trackId);

  const added: QueueItem[] = [];
  for (const item of incoming) {
    if (known.has(item.track_id)) continue;
    known.add(item.track_id);
    added.push(item);
  }
  return added.length === 0 ? buffer : [...buffer, ...added];
}

// --- правка картки просто в навчанні ---

/**
 * Вкласти в буфер щойно збережений вміст картки.
 *
 * Потрібне тому, що буфер тримає КОПІЮ картки, а `mergeIncoming` навмисно
 * пропускає доріжки, які вже в ньому лежать. Без цієї функції виправлена
 * помилка проступила б лише через кілька днів — коли доріжка вдруге приїде з
 * сервера, а до того часу застосунок показував би її старою.
 *
 * Доріжка форм при цьому може й зникнути: у редакторі можна прибрати всі форми
 * або вимкнути їх тренування, і тоді вправа, яку щойно скасували, не має права
 * лишатись на екрані. Доріжка перекладу не зникає ніколи — картка без значень
 * усе одно лишається карткою.
 *
 * Що НЕ робиться: доріжки не переставляються і не додаються. Додати форми
 * картці, яка вже в буфері, — означає завести нову доріжку, а її номер знає
 * тільки сервер; вона приїде наступною вибіркою.
 */
export function applyCardEdit(
  buffer: QueueItem[],
  card: QueueItem["card"] & { forms_drill_enabled: boolean },
): QueueItem[] {
  const formsGone = !card.forms_drill_enabled || card.forms.length === 0;

  const next: QueueItem[] = [];
  for (const item of buffer) {
    if (item.card.id !== card.id) {
      next.push(item);
      continue;
    }
    if (item.kind === "forms" && formsGone) continue;
    next.push({ ...item, card });
  }
  return next;
}

/**
 * Викинути з буфера всі доріжки видаленої картки.
 *
 * Доріжок може бути дві, і обидві мусять піти разом із карткою — інакше друга
 * випливе наступною й отримає 404 на відповідь. Саме тому фільтр по `card.id`,
 * а не по `track_id`.
 */
export function dropCard(buffer: QueueItem[], cardId: number): QueueItem[] {
  return buffer.filter((item) => item.card.id !== cardId);
}

// --- напрямок показу ---

/** Яким боком показати картку. Доріжка форм завжди йде від слова до форм. */
export type CardSide = "en_uk" | "uk_en";

/**
 * Напрямок конкретної картки.
 *
 * При «змішано» вибір мусить бути стабільним: картка, яку забули і яка
 * повернеться через три інші, має показатись тим самим боком. Інакше
 * «Не згадав» на англ→укр раптом перетворюється на іншу вправу, і користувач
 * оцінює вже не те, що забув.
 *
 * Тому не Math.random(), а детермінована функція від track_id і зерна сесії:
 * той самий результат при кожному перемальовуванні, але інший розклад у
 * наступній сесії.
 */
export function cardSide(
  item: QueueItem,
  direction: "en_uk" | "uk_en" | "mixed",
  seed: number,
): CardSide {
  if (item.kind === "forms") return "en_uk";
  if (direction !== "mixed") return direction;
  // Кнут: множення на велике непарне число перемішує сусідні id.
  const mixed = Math.imul(item.track_id ^ seed, 2654435761) >>> 0;
  return mixed % 2 === 0 ? "en_uk" : "uk_en";
}

// --- денний лічильник ---

/**
 * Прогрес до денної цілі повторень.
 *
 * `serverReviews` — число з останньої вдалої вибірки `/study/today/`.
 * `localTracks` — різні доріжки, відповіді на які сталися ПІСЛЯ неї.
 *
 * Різні доріжки, а не відповіді: бекенд рахує `COUNT(DISTINCT track_id)`, бо з
 * кроками навчання одна доріжка дає 2–3 записи за день. Якби клієнт рахував
 * натискання, цифра розійшлася б із `/today/` удвічі-втричі — і саме в той бік,
 * який приємно виглядає.
 */
export type Progress = {
  day: DayKey;
  serverReviews: number;
  localTracks: number[];
};

export function emptyProgress(day: DayKey): Progress {
  return { day, serverReviews: 0, localTracks: [] };
}

/** Скільки показати на екрані. */
export function progressValue(progress: Progress): number {
  return progress.serverReviews + progress.localTracks.length;
}

/**
 * Зарахувати відповідь.
 *
 * Доріжка, відповідь на яку сьогодні вже була, лічильник не рухає. Зміна доби
 * обнуляє все: новий день починається з нуля навіть посеред сесії, бо саме так
 * його рахує сервер.
 */
export function countAnswer(
  progress: Progress,
  trackId: number,
  day: DayKey,
): Progress {
  const base = progress.day === day ? progress : emptyProgress(day);
  if (base.localTracks.includes(trackId)) return base;
  return { ...base, localTracks: [...base.localTracks, trackId] };
}

/**
 * Прийняти число від сервера і скинути локальну дельту.
 *
 * Викликати можна ЛИШЕ коли черга відправки порожня. Інакше сервер ще не знає
 * про надіслані відповіді, а дельта вже обнулена — і лічильник стрибне назад.
 */
export function syncProgress(serverReviews: number, day: DayKey): Progress {
  return { day, serverReviews, localTracks: [] };
}
