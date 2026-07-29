/**
 * Чотири періоди «Прогресу» — плитки, які тепер є перемикачами.
 *
 * Живе окремо від екрана, бо кожен період має ЧОТИРИ різні межі, і плутати їх
 * легко (ADR-0018):
 *
 * - `from` — для агрегатів; закритих майбутніх днів не буває, тож усе, що
 *   рахується, спиняється на сьогодні
 * - `barsFrom`/`barsTo` — для смужки; вона малює весь період, включно з
 *   майбутньою частиною тижня, бо в тижня сім днів незалежно від того, яка
 *   сьогодні середа
 * - `unit` — дрібність смужки: тиждень і місяць по днях, рік і «загалом» по
 *   місяцях, бо рік по днях це 365 стовпчиків шириною в піксель
 *
 * `from = null` в «загалом» означає «уся історія», а не «з початку часів»: до
 * переносу словника днів навчання не існувало (ADR-0004).
 */

import {
  addDays,
  addMonths,
  monthEnd,
  monthStart,
  startOfWeek,
  type DayKey,
} from "../study/day";

export type PeriodKey = "week" | "month" | "year" | "all";

export type Period = {
  key: PeriodKey;
  /** Підпис на плитці. Капс робить CSS — тут звичайний регістр. */
  label: string;
  /** Межі періоду словами, у шапці розкритої панелі. */
  title: string;
  from: DayKey | null;
  barsFrom: DayKey;
  barsTo: DayKey;
  unit: "day" | "month";
};

/** «лип» — без точки, яку `month: "short"` додає в українській локалі. */
function shortMonth(day: DayKey): string {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "UTC", month: "short" })
    .format(new Date(`${day}T00:00:00Z`))
    .replace(".", "");
}

/** «липень». Рік не пишеться: `year: "numeric"` дає «2026 р.», у капсі «2026 Р.». */
export function monthName(day: DayKey): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    month: "long",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** «27 лип – 2 серп», а в межах одного місяця — «3 – 9 серп». */
function dayRange(from: DayKey, to: DayKey): string {
  const fromDay = Number(from.slice(8, 10));
  const toDay = Number(to.slice(8, 10));
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${fromDay} – ${toDay} ${shortMonth(to)}`;
  }
  return `${fromDay} ${shortMonth(from)} – ${toDay} ${shortMonth(to)}`;
}

/** «27 лип 2026». Рік тут потрібен: «загалом» з часом переростає один рік. */
function dayWithYear(day: DayKey): string {
  return `${Number(day.slice(8, 10))} ${shortMonth(day)} ${day.slice(0, 4)}`;
}

/**
 * Описи всіх чотирьох періодів на сьогодні.
 *
 * `first` потрібен лише «загалом»: смужка мусить починатись місяцем, у якому
 * зʼявився перший день навчання, а не місяцем реєстрації й не січнем. Коли
 * історії ще немає, період згортається в поточний місяць — тоді смужка буде з
 * одного порожнього стовпчика, і це чесно.
 */
export function periodsFor(today: DayKey, first: DayKey | null): Period[] {
  const weekFrom = startOfWeek(today);
  const weekTo = addDays(weekFrom, 6);
  const year = today.slice(0, 4);

  return [
    {
      key: "week",
      label: "тиждень",
      title: dayRange(weekFrom, weekTo),
      from: weekFrom,
      barsFrom: weekFrom,
      barsTo: weekTo,
      unit: "day",
    },
    {
      key: "month",
      label: "місяць",
      title: monthName(today),
      from: monthStart(today),
      barsFrom: monthStart(today),
      barsTo: monthEnd(today),
      unit: "day",
    },
    {
      key: "year",
      label: "рік",
      title: `${year} рік`,
      from: `${year}-01-01`,
      barsFrom: `${year}-01-01`,
      // Грудень того ж року. Через addMonths, а не рядком «-12-01»: так межа
      // лишається однією арифметикою з рештою.
      barsTo: addMonths(`${year}-01-01`, 11),
      unit: "month",
    },
    {
      key: "all",
      label: "загалом",
      title: first === null ? "історії ще немає" : `з ${dayWithYear(first)}`,
      from: null,
      barsFrom: monthStart(first ?? today),
      barsTo: monthStart(today),
      unit: "month",
    },
  ];
}
