/**
 * Чиста логіка граматики: чернетка редактора, тіло запиту, локальний пошук.
 *
 * Тут немає ні React, ні мережі — усе, що можна перевірити Vitest, живе саме
 * тут. Найризикованіше в файлі — `toNotePayload`: помилка в ньому не падає, а
 * тихо стирає тіло нотатки (той самий клас, що `senses: []` у словнику).
 */

import type { components } from "../api/schema";

export type Note = components["schemas"]["GrammarNoteSchema"];
export type NoteCategory = components["schemas"]["NoteCategorySchema"];

export const MAX_TITLE_LENGTH = 255;
export const MAX_CATEGORY_LENGTH = 100;

/** Довжина уривка в рядку списку. Далі й так не влізе на екран телефона. */
const SNIPPET_LENGTH = 90;

export type NoteDraft = {
  title: string;
  /** Розділ задається НАЗВОЮ: бекенд заводить його сам, id тут не потрібен. */
  category: string;
  body: string;
};

export function blankDraft(category = ""): NoteDraft {
  return { title: "", category, body: "" };
}

export function toDraft(note: Note): NoteDraft {
  return {
    title: note.title,
    category: note.category_name ?? "",
    body: note.body_markdown ?? "",
  };
}

/**
 * Чернетка → тіло `POST`/`PATCH`.
 *
 * Порожній рядок тут значущий, і в цьому вся тонкість. Бекенд перетворює `""` на
 * `null` (`OptionalText`), тож порожнє тіло справді стирає тіло, а порожній
 * розділ справді прибирає розділ — нотатка їде в «Без розділу». Саме цього
 * користувач і чекає, коли зачистив поле руками.
 *
 * Тому редактор шле обидва поля ЗАВЖДИ, а не «лише змінені»: `PATCH` розрізняє
 * «поля немає» (лишити як є) і `null` (прибрати), і вибіркова відправка зробила
 * б очищення поля непомітним для сервера.
 *
 * Заголовок обрізається, але порожнім не стає: його порожнечу ловить
 * `titleProblem` ДО відправки, бо `RequiredText` на бекенді дав би 422.
 */
export function toNotePayload(draft: NoteDraft): {
  title: string;
  body_markdown: string;
  category: string;
} {
  return {
    title: draft.title.trim(),
    // Тіло не тримається: у Markdown відступ на початку рядка може бути
    // значущим, а от хвостові порожні рядки — ні.
    body_markdown: draft.body.replace(/\s+$/, ""),
    category: draft.category.trim(),
  };
}

export function draftIsDirty(initial: NoteDraft, draft: NoteDraft): boolean {
  const a = toNotePayload(initial);
  const b = toNotePayload(draft);
  return (
    a.title !== b.title ||
    a.body_markdown !== b.body_markdown ||
    a.category !== b.category
  );
}

/** Чому заголовок не годиться, українською. `null` — годиться. */
export function titleProblem(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return "Нотатка мусить мати назву.";
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return `Назва задовга: ${trimmed.length} символів із ${MAX_TITLE_LENGTH}.`;
  }
  return null;
}

export function categoryProblem(category: string): string | null {
  const trimmed = category.trim();
  if (trimmed.length > MAX_CATEGORY_LENGTH) {
    return `Назва розділу задовга: ${trimmed.length} символів із ${MAX_CATEGORY_LENGTH}.`;
  }
  return null;
}

/**
 * Локальний пошук по заголовку й тілу.
 *
 * Він саме локальний, а не серверний, і це свідома розбіжність зі словником.
 * Словник важить 750 КБ, тож повний кеш вимагав би другої реалізації пошуку;
 * довідник важить одиниці кілобайт і завантажується цілком, тож локальний пошук
 * не додає реалізації — він її ЄДИНИЙ. Побічний виграш: граматика шукається без
 * звʼязку, тоді як словник офлайн пошук гасить.
 *
 * Регістр знімається `toLowerCase()`, який знає кирилицю; посимвольного
 * порівняння з локаллю тут не треба — «Часи» і «часи» він зводить правильно.
 */
export function matchesQuery(note: Note, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${note.title}\n${note.body_markdown ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

export function filterNotes(notes: Note[], query: string): Note[] {
  return notes.filter((note) => matchesQuery(note, query));
}

/**
 * Перший змістовний рядок тіла — для рядка списку.
 *
 * Розмітка з нього знімається: у списку «- Make використовується…» з дефісом
 * попереду читається як недомальований пункт, а не як уривок. Порожнє тіло дає
 * порожній рядок, і рядок списку просто його не малює.
 */
export function snippet(body: string | null | undefined): string {
  const line = String(body ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item !== "");
  if (!line) return "";

  const plain = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/[*`_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return plain.length > SNIPPET_LENGTH
    ? `${plain.slice(0, SNIPPET_LENGTH).trimEnd()}…`
    : plain;
}

/** Скільки підказок показуємо за раз. Більше — і чипи стають стіною. */
export const CATEGORY_SUGGESTION_LIMIT = 6;

export type CategorySuggestions = {
  names: string[];
  /** Скільки розділів не влізло. Нуль — підпис не потрібен. */
  hidden: number;
};

/**
 * Підказки розділів для редактора.
 *
 * Розділів може стати багато, тож показувати всі не можна: суцільний рядок
 * чипів на пів екрана гірший за відсутність підказок. Правило просте.
 *
 * **Поле порожнє** — шість найбільших розділів за `note_count`. Не перші за
 * порядком і не найновіші: розділ, у якому вже лежить 40 нотаток, потрібен
 * частіше за той, куди поклали одну. Решта не зникає — про неї каже `hidden`, і
 * дістати її можна набором.
 *
 * **У полі щось є** — розділи, що містять набране, шматком у будь-якому місці
 * назви й без огляду на регістр. Двох-трьох літер вистачає, щоб із півсотні
 * лишився потрібний.
 *
 * **Точний збіг** — підказок немає взагалі: вибирати вже нема з чого, а рядок
 * чипів під заповненим полем тільки з'їдав би місце.
 *
 * Порожні розділи з переліку не викидаються: розділ, з якого пішла остання
 * нотатка, лишається живим (CONTEXT.md), і саме він найімовірніше знадобиться
 * знову — його спорожнили щойно. Але за `note_count` вони природно опиняються в
 * хвості, тобто при порожньому полі не займають місця в шістці.
 */
export function categorySuggestions(
  categories: NoteCategory[],
  typed: string,
): CategorySuggestions {
  const needle = typed.trim().toLowerCase();

  if (needle !== "" && categories.some((c) => c.name.toLowerCase() === needle)) {
    return { names: [], hidden: 0 };
  }

  const matching =
    needle === ""
      ? [...categories].sort((a, b) => b.note_count - a.note_count)
      : categories.filter((c) => c.name.toLowerCase().includes(needle));

  return {
    names: matching.slice(0, CATEGORY_SUGGESTION_LIMIT).map((c) => c.name),
    hidden: Math.max(0, matching.length - CATEGORY_SUGGESTION_LIMIT),
  };
}
