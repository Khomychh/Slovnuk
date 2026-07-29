/**
 * Межі чотирьох періодів.
 *
 * У кожного їх три набори — для агрегатів, для смужки і для підпису — і
 * сплутати їх легко саме тому, що переплутане виглядає правдоподібно: смужка
 * тижня з чотирьох стовпчиків у середу читається як «тиждень скінчився», а не
 * як помилка.
 */

import { describe, expect, it } from "vitest";
import { periodsFor } from "./periods";

/** Четвер 30 липня 2026. Тиждень: пн 27.07 — нд 02.08. */
const TODAY = "2026-07-30";

function pick(today: string, first: string | null, key: string) {
  const period = periodsFor(today, first).find((item) => item.key === key);
  if (!period) throw new Error(`немає періоду ${key}`);
  return period;
}

describe("тиждень", () => {
  it("іде з понеділка по неділю, а не сім днів назад", () => {
    const week = pick(TODAY, "2026-06-14", "week");
    expect(week.from).toBe("2026-07-27");
    expect(week.barsFrom).toBe("2026-07-27");
    expect(week.barsTo).toBe("2026-08-02");
    expect(week.unit).toBe("day");
  });

  it("смужка охоплює весь тиждень, включно з майбутніми днями", () => {
    // Сьогодні четвер, але стовпчиків мусить бути сім: у тижня сім днів
    // незалежно від того, який сьогодні день.
    const week = pick(TODAY, "2026-06-14", "week");
    expect(week.barsTo > TODAY).toBe(true);
  });

  it("підписує межі, і в межах місяця не повторює його двічі", () => {
    expect(pick(TODAY, "2026-06-14", "week").title).toBe("27 лип – 2 серп");
    // Тиждень 3–9 серпня цілком у серпні: «3 серп – 9 серп» було б зайвим.
    expect(pick("2026-08-05", "2026-06-14", "week").title).toBe("3 – 9 серп");
  });
});

describe("місяць", () => {
  it("іде з першого по останнє число поточного місяця", () => {
    const month = pick(TODAY, "2026-06-14", "month");
    expect(month.from).toBe("2026-07-01");
    expect(month.barsFrom).toBe("2026-07-01");
    expect(month.barsTo).toBe("2026-07-31");
    expect(month.unit).toBe("day");
    expect(month.title).toBe("липень");
  });

  it("знає короткий місяць", () => {
    expect(pick("2026-02-10", null, "month").barsTo).toBe("2026-02-28");
  });
});

describe("рік", () => {
  it("іде по місяцях від січня до грудня того ж року", () => {
    const year = pick(TODAY, "2026-06-14", "year");
    expect(year.from).toBe("2026-01-01");
    expect(year.barsFrom).toBe("2026-01-01");
    expect(year.barsTo).toBe("2026-12-01");
    expect(year.unit).toBe("month");
    expect(year.title).toBe("2026 рік");
  });
});

describe("загалом", () => {
  it("не обмежує агрегати нічим", () => {
    expect(pick(TODAY, "2026-06-14", "all").from).toBeNull();
  });

  it("починає смужку місяцем першого дня історії, а не січнем", () => {
    const all = pick(TODAY, "2026-06-14", "all");
    expect(all.barsFrom).toBe("2026-06-01");
    expect(all.barsTo).toBe("2026-07-01");
    expect(all.unit).toBe("month");
  });

  it("пише рік у підписі — «загалом» з часом переростає один рік", () => {
    expect(pick(TODAY, "2025-11-03", "all").title).toBe("з 3 лист 2025");
  });

  it("без історії згортається в поточний місяць і каже це прямо", () => {
    const all = pick(TODAY, null, "all");
    expect(all.barsFrom).toBe("2026-07-01");
    expect(all.barsTo).toBe("2026-07-01");
    expect(all.title).toBe("історії ще немає");
  });
});

describe("порядок плиток", () => {
  it("сталий — під ним стоїть дзьоб панелі, і він їде за номером", () => {
    expect(periodsFor(TODAY, null).map((period) => period.key)).toEqual([
      "week",
      "month",
      "year",
      "all",
    ]);
  });
});
