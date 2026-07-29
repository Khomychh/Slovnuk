/**
 * Межі доби й тижня в поясі користувача.
 *
 * Дзеркало `backend/tests/test_day_counts.py`: там перевіряють, що Postgres і
 * Python однаково рахують добу, тут — що браузер рахує її так само. Це єдине
 * місце застосунку, де та сама відповідь може потрапити в різні дні залежно від
 * того, хто рахує.
 */

import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysInMonth,
  daysInclusive,
  localDay,
  monthEnd,
  monthStart,
  resolveTimeZone,
  startOfWeek,
  timeZoneNeedsSync,
  weekDays,
  weekdayIndex,
} from "./day";

const KYIV = "Europe/Kyiv";

describe("localDay", () => {
  it("бере дату в поясі користувача, а не в UTC", () => {
    // Влітку Київ — UTC+3. 20:30 UTC це 23:30 того самого дня.
    expect(localDay(new Date("2026-07-28T20:30:00Z"), KYIV)).toBe("2026-07-28");
    // 21:30 UTC — у Києві вже настало 29-те, а в UTC ще 28-ме.
    expect(localDay(new Date("2026-07-28T21:30:00Z"), KYIV)).toBe("2026-07-29");
  });

  it("тримає межу опівночі з точністю до хвилини", () => {
    // Влітку Київ — UTC+3, тож локальна північ це 21:00 UTC.
    expect(localDay(new Date("2026-07-28T20:59:00Z"), KYIV)).toBe("2026-07-28");
    expect(localDay(new Date("2026-07-28T21:01:00Z"), KYIV)).toBe("2026-07-29");
  });

  it("враховує зміну зсуву взимку", () => {
    // Взимку Київ — UTC+2, тож та сама межа переїжджає на 22:00 UTC.
    expect(localDay(new Date("2026-01-15T21:59:00Z"), KYIV)).toBe("2026-01-15");
    expect(localDay(new Date("2026-01-15T22:01:00Z"), KYIV)).toBe("2026-01-16");
  });

  it("однаково працює по інший бік від Гринвіча", () => {
    expect(localDay(new Date("2026-07-28T03:00:00Z"), "America/New_York")).toBe(
      "2026-07-27",
    );
  });
});

describe("resolveTimeZone", () => {
  it("пропускає справжню назву", () => {
    expect(resolveTimeZone(KYIV)).toBe(KYIV);
  });

  it("на одруківці відкочується на пояс браузера, а не падає", () => {
    const resolved = resolveTimeZone("Europe/Kyviv");
    expect(resolved).not.toBe("Europe/Kyviv");
    expect(
      () => new Intl.DateTimeFormat("en-CA", { timeZone: resolved }),
    ).not.toThrow();
  });

  it("порожнє значення теж не валить розрахунок", () => {
    expect(() => localDay(new Date(), resolveTimeZone(null))).not.toThrow();
  });
});

describe("addDays", () => {
  it("рахує через межу місяця", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("рахує через межу року", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("не збивається в день переходу на літній час", () => {
    // 2026-03-29 у Києві доба коротша на годину: 03:00 одразу стає 04:00.
    // Арифметика над датами не має цього помічати взагалі.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-03-29", -1)).toBe("2026-03-28");
  });

  it("не збивається в день переходу на зимовий час", () => {
    // 2026-10-25 доба довша на годину — і локальна північ трапляється двічі.
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });
});

describe("тиждень", () => {
  it("починається з понеділка", () => {
    // 2026-07-28 — вівторок.
    expect(weekdayIndex("2026-07-27")).toBe(0);
    expect(weekdayIndex("2026-07-28")).toBe(1);
    expect(weekdayIndex("2026-08-02")).toBe(6);
  });

  it("для неділі бере попередній понеділок, а не наступний", () => {
    // Найлегша помилка: у JS getDay() неділя це 0, і без зсуву тиждень
    // «неділя—субота» поїхав би на шість днів уперед.
    expect(startOfWeek("2026-08-02")).toBe("2026-07-27");
  });

  it("дає сім діб поспіль", () => {
    expect(weekDays("2026-07-28")).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("дає сім діб і на тижні з переходом на літній час", () => {
    // 2026-03-29 — неділя, і саме тієї ночі переводять годинник.
    expect(weekDays("2026-03-29")).toEqual([
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
    ]);
  });
});

describe("timeZoneNeedsSync", () => {
  it("мовчить, коли телефон і збережене значення збігаються", () => {
    expect(timeZoneNeedsSync(KYIV, KYIV)).toBe(false);
  });

  it("просить переписати після переїзду", () => {
    expect(timeZoneNeedsSync(KYIV, "Europe/Warsaw")).toBe(true);
  });

  it("просить переписати, коли збереженого поясу ще немає", () => {
    expect(timeZoneNeedsSync(null, KYIV)).toBe(true);
    expect(timeZoneNeedsSync("", KYIV)).toBe(true);
  });

  it("не замінює збережений пояс на сміття від браузера", () => {
    // Краще лишити старий, ніж записати те, що сервер однаково відкине.
    expect(timeZoneNeedsSync(KYIV, "Europe/Атлантида")).toBe(false);
    expect(timeZoneNeedsSync(KYIV, "")).toBe(false);
  });

  it("виправляє зіпсоване збережене значення", () => {
    // У колонці вільний рядок на 64 символи, тож одруківка там можлива.
    expect(timeZoneNeedsSync("Europe/Kyv", KYIV)).toBe(true);
  });
});

describe("daysInclusive", () => {
  it("рахує обидва кінці", () => {
    expect(daysInclusive("2026-07-27", "2026-07-29")).toBe(3);
    expect(daysInclusive("2026-07-29", "2026-07-29")).toBe(1);
  });

  it("не збивається на переході на літній час", () => {
    // Ніч на 2026-03-29 коротша на годину, але діб від цього не меншає.
    expect(daysInclusive("2026-03-28", "2026-03-30")).toBe(3);
  });

  it("віддає нуль, коли кінець раніший за початок", () => {
    expect(daysInclusive("2026-07-29", "2026-07-27")).toBe(0);
  });
});

describe("межі місяця", () => {
  it("бере перше й останнє число того самого місяця", () => {
    expect(monthStart("2026-07-29")).toBe("2026-07-01");
    expect(monthEnd("2026-07-29")).toBe("2026-07-31");
  });

  it("знає короткі місяці й лютий високосного року", () => {
    expect(daysInMonth("2026-02-14")).toBe(28);
    expect(daysInMonth("2024-02-14")).toBe(29);
    expect(monthEnd("2026-04-30")).toBe("2026-04-30");
  });

  it("додає місяці через грудень, а не через 30 діб", () => {
    // Найлегша помилка тут — рахувати місяць як addDays(day, 30): тоді за рік
    // смужка «загалом» втратила б пʼять відрізків, а за три роки — два тижні.
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("не спотикається об 31 число при переході в короткий місяць", () => {
    // Січень має 31 день, лютий — ні. Функція завжди повертає ПЕРШЕ число,
    // тож «31 лютого» тут не може виникнути навіть теоретично.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
  });
});
