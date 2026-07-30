/**
 * Правила Бібліотеки — усе, у чому можна помилитись тихо.
 *
 * Як і в `sharing/share.ts`, головне тут — речення, що описують наслідок.
 * Взяття **пропускає** слова, які в тебе вже є (ADR-0005), тож зі списку на 540
 * слів може додатись 495 — а може й нуль. Не сказавши цього до натискання, екран
 * виглядає зламаним, а не вибірковим.
 *
 * Функції чисті навмисно: помилка в цих реченнях не падає, а бреше.
 */

import { plural, words } from "../ui/plural";

/**
 * Рейтинг у вигляді, придатному для показу, або `null` — коли показувати нічого.
 *
 * Саме `null`, а не «поки без оцінок»: відсутність рейтингу сама є інформацією, і
 * підписувати її словами означає додати текст, який нічого не додає. Порожнє
 * місце праворуч читається швидше за будь-яке речення. Тип змушує кожне місце
 * показу вирішити це свідомо, а не отримати рядок-заглушку.
 *
 * `rating: null` приходить із сервера й означає «оцінок менше за поріг» — і при
 * нулі, і при одній-двох. Поріг тут НЕ перераховується: він живе одним
 * SQL-виразом на бекенді, бо витрина сортує за рейтингом у базі. Повторити його
 * тут означало б завести друге правило, яке розійдеться з першим, — і показувати
 * число, якого немає в сортуванні.
 */
export function ratingLine(publication: {
  rating: number | null;
  ratings_count: number;
}): string | null {
  if (publication.rating === null) return null;
  // toFixed(1), а не просто число: сервер віддає 5 як 5.0, і JSON робить із
  // цього 5. Без вирівнювання поруч стояли б «4.6» і «5», що читається як
  // різна точність.
  return `${publication.rating.toFixed(1)} ★ (${publication.ratings_count})`;
}

/** «540 слів · взяли 128». Друге число — охоплення, і воно завжди чесне. */
export function reachLine(publication: {
  cards_count: number;
  takes_count: number;
}): string {
  return `${words(publication.cards_count)} · взяли ${publication.takes_count}`;
}

/**
 * Головне речення сторінки публікації — те, що станеться після натискання.
 *
 * Саме `new_cards`, а не `cards_count`: друге описує чужий список, а перше —
 * наслідок для твого словника.
 */
export function takeHeadline(publication: {
  cards_count: number;
  new_cards: number;
}): string {
  if (publication.cards_count === 0) return "У цьому списку немає слів";
  if (publication.new_cards === 0) return "Усі ці слова у вас уже є";
  if (publication.new_cards === publication.cards_count) {
    return `Додасться ${words(publication.new_cards)}`;
  }
  return `Додасться ${publication.new_cards} із ${words(publication.cards_count)}`;
}

/** Скільки слів публікації в читача вже є. */
export function alreadyHave(publication: {
  cards_count: number;
  new_cards: number;
}): number {
  return Math.max(0, publication.cards_count - publication.new_cards);
}

/**
 * Уточнення під головним реченням.
 *
 * Порожнє, коли уточнювати нічого. Перезапису в Бібліотеці немає, тож
 * альтернативи «замінити» тут не пропонується — лишається сказати правду про
 * пропуск.
 */
export function takeNote(publication: {
  cards_count: number;
  new_cards: number;
}): string | null {
  const already = alreadyHave(publication);
  if (already === 0) return null;
  return `${words(already)} у вас уже є — ${plural(
    already,
    "його",
    "їх",
    "їх",
  )} взяття не чіпає.`;
}

/** Підпис автора. `null` означає, що автор видалив акаунт. */
export function authorLine(author: string | null | undefined): string {
  const name = author?.trim();
  return name || "автор пішов";
}

/**
 * Позначка походження похідної публікації.
 *
 * Без неї витрина заповнюється копіями, а через пропуск наявних копія ще й
 * неповна проти оригіналу.
 */
export function derivedLine(title: string | null | undefined): string | null {
  const name = title?.trim();
  return name ? `росте з «${name}»` : null;
}

/**
 * «оновлено 30 липня».
 *
 * Показується завжди, а не лише коли давно: разом із рейтингом ця дата — єдиний
 * спосіб побачити розбіжність «31 оцінка, а вміст учорашній». Рік дописується
 * тільки для іншого року, інакше він з'їдає рядок ні за що.
 */
export function updatedLine(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const sameYear = date.getFullYear() === now.getFullYear();
  const formatted = date.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `оновлено ${formatted}`;
}

/**
 * Звіт після взяття.
 *
 * Поля `overwritten` тут немає й бути не може — у Бібліотеці нічого не
 * перезаписується.
 */
export function takeSummary(result: {
  created: number;
  skipped: number;
}): string {
  const parts: string[] = [];
  if (result.created > 0) parts.push(`додано ${words(result.created)}`);
  if (result.skipped > 0) parts.push(`пропущено ${words(result.skipped)}`);
  if (parts.length === 0) return "Список порожній — додавати було нічого.";
  return `${parts.join(" · ")}.`;
}

/**
 * Порожній результат — не помилка.
 *
 * Бекенд не створює списку, якщо додавати нічого: порожня іменована мітка в
 * словнику була б сміттям, яке користувач мусив би прибирати руками.
 */
export function takeFoundNothing(result: { list_id: number | null }): boolean {
  return result.list_id === null;
}

/**
 * Скільки пропущених слів показати списком і скільки лишилось за кадром.
 *
 * Показувати всі 540 неможливо, а не показувати жодного — це та сама
 * неповнота, про яку не сказали. Обрізаємо на десяти й чесно кажемо, скільки
 * ще: рядок «і ще 530» несе не менше за самі слова.
 */
export function skippedPreview(
  skipped: string[],
  limit = 10,
): { shown: string[]; rest: number } {
  return {
    shown: skipped.slice(0, limit),
    rest: Math.max(0, skipped.length - limit),
  };
}

/** Підписи причин скарги. Набір закритий — вільного тексту немає навмисно. */
export const REPORT_REASONS = [
  { value: "wrong", label: "Помилки у словах" },
  { value: "obscene", label: "Непристойний вміст" },
  { value: "spam", label: "Реклама або спам" },
  { value: "other", label: "Інше" },
] as const;

/** Підписи порядку витрини. */
export const SORT_LABELS = {
  popular: "популярні",
  fresh: "нові",
  rating: "за рейтингом",
} as const;

/**
 * Чи можна публікувати цей список.
 *
 * Порожній список публікувати нема сенсу: знімок вийшов би порожнім, а взяття
 * такої публікації не додало б нічого. Бекенд це не забороняє — і не мусить,
 * бо список може наповнитись пізніше, а публікація вже існує.
 */
export function canPublish(cardCount: number): boolean {
  return cardCount > 0;
}

/**
 * Що сказати автору про застарілий знімок.
 *
 * Єдиний сигнал, який ми маємо, — різниця кількостей, і він неповний навмисно:
 * виправлений в одному слові переклад кількості не змінює. Тому текст говорить
 * саме про числа, а не обіцяє «все актуально».
 */
export function stalenessLine(publication: {
  cards_count: number;
  list_cards_count: number | null;
}): string | null {
  const live = publication.list_cards_count;
  if (live === null) return "Список видалено — оновити публікацію вже нема з чого.";
  if (live === publication.cards_count) return null;

  const diff = live - publication.cards_count;
  return diff > 0
    ? `У списку на ${diff} ${plural(diff, "слово", "слова", "слів")} більше, ніж у публікації.`
    : `У списку на ${-diff} ${plural(-diff, "слово", "слова", "слів")} менше, ніж у публікації.`;
}
