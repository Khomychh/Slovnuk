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

/** Пояс, у якому зараз стоїть телефон. */
export function detectTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Чи треба переписати збережений пояс на той, що показує телефон.
 *
 * Органу керування поясом у застосунку немає навмисно: доба їде за телефоном,
 * як і годинник на ньому. Наслідок цього видно не одразу — календар прогресу
 * рахує дні заново (`GROUP BY … AT TIME ZONE`), тож після перельоту нічні
 * відповіді можуть перескочити в сусідню добу. Закриті дні при цьому не
 * перераховуються: `is_goal_met` — заморожений факт.
 *
 * Альтернатива «записати один раз при першому вході» виглядає обережнішою, а
 * насправді створює стан, який користувач не може ні побачити, ні виправити —
 * пояс назавжди лишається тим, у якому людина колись зареєструвалась.
 *
 * Непридатне значення від браузера не пишемо: краще лишити збережене, ніж
 * замінити його на сміття, яке сервер потім відкине.
 */
export function timeZoneNeedsSync(
  stored: string | null | undefined,
  detected: string,
): boolean {
  if (!detected) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: detected });
  } catch {
    return false;
  }
  return stored !== detected;
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

/**
 * Перший день місяця, у якому лежить `day`.
 *
 * Через рядок, а не через Date: ключ уже «РРРР-ММ-ДД», і перше число того ж
 * місяця — це той самий рядок з іншим хвостом. Жодного поясу тут не потрібно.
 */
export function monthStart(day: DayKey): DayKey {
  return `${day.slice(0, 7)}-01`;
}

/** Скільки діб у місяці ключа. Рахується через UTC — ключ уже без часу. */
export function daysInMonth(day: DayKey): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  // Нульовий день наступного місяця — останній день поточного.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Останній день місяця, у якому лежить `day`. */
export function monthEnd(day: DayKey): DayKey {
  return `${day.slice(0, 7)}-${String(daysInMonth(day)).padStart(2, "0")}`;
}

/**
 * Додати (або відняти) стільки календарних місяців; повертає ПЕРШЕ число.
 *
 * Полудень тут не потрібен і навіть шкідливий: `Date.UTC(y, m + n, 1)` сам
 * нормалізує перехід через грудень, а числа, що не існують у цільовому місяці
 * (31 лютого), до цієї функції не доходять — вона завжди починає з першого.
 */
export function addMonths(day: DayKey, amount: number): DayKey {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const moment = new Date(Date.UTC(year, month - 1 + amount, 1));
  return moment.toISOString().slice(0, 10);
}

/** Скільки діб від `from` до `to` включно з обома кінцями. Назад — нуль. */
export function daysInclusive(from: DayKey, to: DayKey): number {
  if (from > to) return 0;
  const span = toUtcNoon(to).getTime() - toUtcNoon(from).getTime();
  return Math.round(span / 86_400_000) + 1;
}
