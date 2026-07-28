/**
 * Локальна доба й тиждень у поясі користувача.
 *
 * Дзеркало `backend/app/services/study_day.py`: сервер рахує добу через
 * `AT TIME ZONE`, а клієнт мусить отримувати ту саму дату для того самого
 * моменту — інакше крапки тижня і денний лічильник розійдуться з `/today/`
 * рівно на межі опівночі, тобто там, де це найважче помітити.
 *
 * Доба тут завжди від 00:00 до 00:00. Anki-подібне «доба починається о 04:00»
 * свідомо не робиться — на бекенді його теж немає.
 */

/** Дата без часу, у вигляді "2026-07-28". Порівнюється рядками. */
export type DayKey = string;

/**
 * Пояс, яким справді можна користуватись.
 *
 * `user_settings.timezone` — вільний рядок на 64 символи, тож у ньому цілком
 * може лежати одруківка. Бекенд у такому разі відкочується на UTC
 * (`resolve_timezone`); тут відкочуємось на пояс браузера — він майже завжди
 * і є правильною відповіддю, а UTC на телефоні в Києві дав би зсув на межі
 * доби без жодного повідомлення.
 */
export function resolveTimeZone(name: string | null | undefined): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (!name) return fallback;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: name });
    return name;
  } catch {
    return fallback;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // en-CA дає рівно "YYYY-MM-DD" — те саме, що ISO-дата, і без розбору частин.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Яка доба була в цьому поясі в момент `instant`. */
export function localDay(instant: Date, timeZone: string): DayKey {
  return formatterFor(resolveTimeZone(timeZone)).format(instant);
}

/**
 * Арифметика над датами йде через UTC-полудень, а не через локальну північ.
 *
 * У день переходу на літній час локальна північ може не існувати або статись
 * двічі, і `new Date(y, m, d)` тоді зсуває дату на добу. Полудень від цього
 * захищений із запасом у 12 годин, а нам потрібен лише номер дня тижня і
 * додавання діб.
 */
function toUtcNoon(day: DayKey): Date {
  const parts = day.split("-");
  return new Date(
    Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12),
  );
}

function fromUtcNoon(instant: Date): DayKey {
  return instant.toISOString().slice(0, 10);
}

/** Додати (або відняти) стільки діб. */
export function addDays(day: DayKey, amount: number): DayKey {
  const moment = toUtcNoon(day);
  moment.setUTCDate(moment.getUTCDate() + amount);
  return fromUtcNoon(moment);
}

/** 0 — понеділок, 6 — неділя. Тиждень український, а не американський. */
export function weekdayIndex(day: DayKey): number {
  return (toUtcNoon(day).getUTCDay() + 6) % 7;
}

/** Понеділок того тижня, у який потрапляє `day`. */
export function startOfWeek(day: DayKey): DayKey {
  return addDays(day, -weekdayIndex(day));
}

/** Сім діб тижня, від понеділка до неділі включно. */
export function weekDays(day: DayKey): DayKey[] {
  const monday = startOfWeek(day);
  return Array.from({ length: 7 }, (_, offset) => addDays(monday, offset));
}
