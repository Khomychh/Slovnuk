/**
 * Правила шерингу — уся логіка, у якій можна помилитись тихо.
 *
 * Головне тут — тексти, що описують наслідок. Імпорт **пропускає** слова, які в
 * отримувача вже є (ADR-0005), тож зі списку на 50 слів може додатись 38 — і
 * якщо екран цього не сказав, імпорт виглядає зламаним, а не вибірковим.
 *
 * Функції чисті навмисно: помилка в цих реченнях не падає, а бреше.
 */

import type { ImportMode } from "../api/sharing";
import { plural, words } from "../ui/plural";

/** Скільки слів зі списку в отримувача вже є. */
export function alreadyHave(preview: {
  total_cards: number;
  new_cards: number;
}): number {
  return Math.max(0, preview.total_cards - preview.new_cards);
}

/**
 * Чи є взагалі сенс питати про режим.
 *
 * Коли збігів немає, `skip` і `overwrite` роблять рівно те саме, і перемикач
 * був би органом керування без наслідку — гірше, ніж його відсутність: він
 * привчає тиснути «Замінити» тоді, коли різниці не видно.
 */
export function needsMode(preview: {
  total_cards: number;
  new_cards: number;
}): boolean {
  return alreadyHave(preview) > 0;
}

/**
 * Підпис кнопки взяття — наслідок натискання, тепер замість заголовка над
 * списком. Залежить від режиму: у «Замінити» наявні слова не пропускаються.
 */
export function importLabel(
  preview: { total_cards: number; new_cards: number },
  mode: ImportMode,
): string {
  if (preview.total_cards === 0) return "У списку немає слів";
  const already = alreadyHave(preview);

  if (mode === "overwrite" && already > 0) {
    return preview.new_cards === 0
      ? `Замінити ${words(already)}`
      : `Взяти ${words(preview.new_cards)} і замінити ${already}`;
  }
  if (preview.new_cards === 0) return "Усі слова вже є";
  return `Взяти ${words(preview.new_cards)}`;
}

/** Чи додасть натискання хоч щось: пропустити всі наявні — це нічого. */
export function canImport(
  preview: { total_cards: number; new_cards: number },
  mode: ImportMode,
): boolean {
  if (preview.total_cards === 0) return false;
  return mode === "overwrite" ? true : preview.new_cards > 0;
}

/** Підпис автора, коли той заповнив ім'я. Пошту бекенд не віддає ніколи. */
export function ownerLine(ownerName: string | null | undefined): string | null {
  const name = ownerName?.trim();
  return name ? `Поділився ${name}` : null;
}

/**
 * Попередження перед `overwrite`.
 *
 * Мусить називати число і те, що саме зникне. Прогрес не зникає — доріжки
 * живуть на картці, а не на її тексті, — і про це треба сказати, інакше
 * користувач відмовиться від режиму зі страху втратити повторення.
 */
export function overwriteWarning(already: number): string {
  return (
    `${words(already)} у вас уже є, і ${plural(already, "його", "їх", "їх")} вміст ` +
    `буде замінено вмістом із цього списку: значення, приклади, форми, коментар. ` +
    `Ваші переклади зникнуть без можливості відновити. ` +
    `Прогрес повторень залишиться.`
  );
}

/** Звіт після імпорту. Три числа, і жодне не ховається. */
export function importSummary(result: {
  created: number;
  overwritten: number;
  skipped: number;
}): string {
  const parts: string[] = [];
  if (result.created > 0) parts.push(`додано ${words(result.created)}`);
  if (result.overwritten > 0) parts.push(`замінено ${words(result.overwritten)}`);
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
export function importFoundNothing(result: { list_id: number | null }): boolean {
  return result.list_id === null;
}

/**
 * Повна адреса посилання.
 *
 * Origin беремо в браузера, а не з змінної оточення: застосунок і API живуть на
 * одному домені (ADR-0008), тож правильний origin — рівно той, з якого сторінку
 * відкрито. Зашитий домен зламав би посилання в розробці.
 */
export function buildShareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/shares/${token}`;
}
