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
  closedDays,
  daysInclusive,
  localDay,
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
    expect(() => new Intl.DateTimeFormat("en-CA", { timeZone: resolved })).not.toThrow();
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

describe("closedDays", () => {
  const rows = [
    { day: "2026-07-25", is_goal_met: true },
    { day: "2026-07-26", is_goal_met: true },
    { day: "2026-07-28", is_goal_met: false },
    { day: "2026-07-29", is_goal_met: false },
  ];

  it("рахує знаменник календарем, а не кількістю рядків", () => {
    // 27-го користувач не заходив, рядка за нього немає — але день був, і
    // закритим він не був. Інакше пропущений день тихо покращував би цифру.
    expect(closedDays(rows, null, "2026-07-29")).toEqual({ met: 2, total: 5 });
  });

  it("починає знаменник із першого дня історії, а не з початку періоду", () => {
    // Рік почався 1 січня, але до 25 липня днів навчання не існувало.
    expect(closedDays(rows, "2026-01-01", "2026-07-29")).toEqual({
      met: 2,
      total: 5,
    });
  });

  it("тримається початку періоду, коли історія почалась раніше за нього", () => {
    expect(closedDays(rows, "2026-07-28", "2026-07-29")).toEqual({
      met: 0,
      total: 2,
    });
  });

  it("тримає сьогодні у знаменнику, доки воно не закрите", () => {
    const today = closedDays(rows, "2026-07-29", "2026-07-29");
    expect(today).toEqual({ met: 0, total: 1 });

    // Щойно обидві цілі добито, та сама доба стає цілою — без стрибка знизу.
    const done = rows.map((row) =>
      row.day === "2026-07-29" ? { ...row, is_goal_met: true } : row,
    );
    expect(closedDays(done, "2026-07-29", "2026-07-29")).toEqual({
      met: 1,
      total: 1,
    });
  });

  it("не рахує майбутні дні, якщо вони колись приїдуть", () => {
    const withFuture = [...rows, { day: "2026-08-05", is_goal_met: true }];
    expect(closedDays(withFuture, null, "2026-07-29")).toEqual({
      met: 2,
      total: 5,
    });
  });

  it("порожня історія — порожні плитки, а не ділення на нуль", () => {
    expect(closedDays([], null, "2026-07-29")).toEqual({ met: 0, total: 0 });
  });

  it("не залежить від порядку рядків у відповіді", () => {
    expect(closedDays([...rows].reverse(), null, "2026-07-29")).toEqual({
      met: 2,
      total: 5,
    });
  });
});
