/**
 * Підсумки за період.
 *
 * Кожна функція тут має пастку, яка ламається тихо і в один бік — цифра стає
 * кращою, ніж є. Тести цілять саме в них, а не в щасливі шляхи: «серія 3» легко
 * побачити оком, а «серія 5, склеєна через прогул» виглядає як успіх.
 */

import { describe, expect, it } from "vitest";
import {
  closedDays,
  firstDay,
  longestStreak,
  periodVolume,
  volumeBars,
  type DayRow,
} from "./period";

/** Тиждень пн 27.07 — нд 02.08. Середа порожня, тобто рядка за неї НЕМАЄ. */
const week: DayRow[] = [
  { day: "2026-07-27", new_count: 5, review_count: 20, is_goal_met: true },
  { day: "2026-07-28", new_count: 5, review_count: 24, is_goal_met: true },
  // 29-го користувач не заходив — рядка немає навмисно.
  { day: "2026-07-30", new_count: 0, review_count: 11, is_goal_met: false },
  { day: "2026-07-31", new_count: 2, review_count: 18, is_goal_met: true },
  { day: "2026-08-01", new_count: 0, review_count: 11, is_goal_met: true },
];

describe("closedDays", () => {
  it("рахує лише золоті дні періоду", () => {
    expect(closedDays(week, "2026-07-27", "2026-08-02")).toBe(4);
  });

  it("не рахує майбутні дні, якщо вони колись приїдуть", () => {
    const withFuture = [
      ...week,
      { day: "2026-08-05", new_count: 0, review_count: 9, is_goal_met: true },
    ];
    expect(closedDays(withFuture, "2026-07-27", "2026-08-02")).toBe(4);
  });

  it("відрізає дні до початку періоду", () => {
    expect(closedDays(week, "2026-08-01", "2026-08-02")).toBe(1);
  });

  it("null — уся історія", () => {
    expect(closedDays(week, null, "2026-08-02")).toBe(4);
  });

  it("порожня історія — нуль, а не збій", () => {
    expect(closedDays([], null, "2026-08-02")).toBe(0);
  });

  it("не залежить від порядку рядків у відповіді", () => {
    expect(closedDays([...week].reverse(), null, "2026-08-02")).toBe(4);
  });
});

describe("periodVolume", () => {
  it("додає повторення й нові слова за період", () => {
    const volume = periodVolume(week, "2026-07-27", "2026-08-02");
    expect(volume.reviews).toBe(84);
    expect(volume.newCards).toBe(12);
  });

  it("активним робить робота, а не існування рядка дня", () => {
    // Рядок створюється при першій дії доби, але доба могла відкритись цілями
    // і лишитись без роботи. Такий день не активний.
    const withEmptyRow: DayRow[] = [
      ...week,
      { day: "2026-08-02", new_count: 0, review_count: 0, is_goal_met: false },
    ];
    expect(
      periodVolume(withEmptyRow, "2026-07-27", "2026-08-02").activeDays,
    ).toBe(5);
  });

  it("середнє ділить на активні дні, а не на довжину періоду", () => {
    // 84 / 5 активних = 17. Якби ділили на сім днів тижня, вийшло б 12, і
    // «весь час» показував би тим менше, чим довше ти користуєшся застосунком.
    expect(periodVolume(week, "2026-07-27", "2026-08-02").perActiveDay).toBe(
      17,
    );
  });

  it("порожній період — нуль, а не ділення на нуль", () => {
    const volume = periodVolume([], null, "2026-08-02");
    expect(volume).toEqual({
      reviews: 0,
      newCards: 0,
      activeDays: 0,
      perActiveDay: 0,
    });
  });

  it("не бере до підсумку майбутні дні", () => {
    const withFuture = [
      ...week,
      { day: "2026-08-05", new_count: 3, review_count: 9, is_goal_met: true },
    ];
    expect(periodVolume(withFuture, null, "2026-08-02").reviews).toBe(84);
  });
});

describe("longestStreak", () => {
  it("рахує найдовшу низку закритих днів підряд", () => {
    // 27, 28 закриті; 29 відсутній; 30 незакритий; 31, 01 закриті.
    // Дві низки по два — отже 2.
    expect(longestStreak(week, "2026-07-27", "2026-08-02")).toBe(2);
  });

  it("обриває серію днем, у який учився, але не добрав", () => {
    const rows = [
      { day: "2026-07-27", is_goal_met: true },
      { day: "2026-07-28", is_goal_met: false },
      { day: "2026-07-29", is_goal_met: true },
    ];
    expect(longestStreak(rows, null, "2026-07-29")).toBe(1);
  });

  it("обриває серію пропущеним днем, якого в rows узагалі немає", () => {
    // Головна пастка: у масиві ці два дні сусідні, у календарі — ні. Якби
    // послідовність перевірялась сусідством у масиві, прогул СКЛЕЮВАВ би дві
    // серії в одну, тобто покращував би цифру.
    const rows = [
      { day: "2026-07-27", is_goal_met: true },
      { day: "2026-07-29", is_goal_met: true },
    ];
    expect(longestStreak(rows, null, "2026-07-29")).toBe(1);
  });

  it("не склеює серію через порожній місяць", () => {
    const rows = [
      { day: "2026-05-30", is_goal_met: true },
      { day: "2026-05-31", is_goal_met: true },
      { day: "2026-07-01", is_goal_met: true },
    ];
    expect(longestStreak(rows, null, "2026-07-01")).toBe(2);
  });

  it("обрізає межею періоду серію, що її перетинає", () => {
    const rows = [
      { day: "2026-07-30", is_goal_met: true },
      { day: "2026-07-31", is_goal_met: true },
      { day: "2026-08-01", is_goal_met: true },
      { day: "2026-08-02", is_goal_met: true },
    ];
    // Уся серія — чотири дні. Але в серпні від неї лежать тільки два.
    expect(longestStreak(rows, null, "2026-08-02")).toBe(4);
    expect(longestStreak(rows, "2026-08-01", "2026-08-02")).toBe(2);
  });

  it("не бере до серії майбутні дні", () => {
    const rows = [
      { day: "2026-08-01", is_goal_met: true },
      { day: "2026-08-02", is_goal_met: true },
      { day: "2026-08-03", is_goal_met: true },
    ];
    expect(longestStreak(rows, null, "2026-08-02")).toBe(2);
  });

  it("порожня історія — нуль", () => {
    expect(longestStreak([], null, "2026-08-02")).toBe(0);
    expect(longestStreak(week, "2027-01-01", "2027-01-05")).toBe(0);
  });

  it("не залежить від порядку рядків у відповіді", () => {
    expect(longestStreak([...week].reverse(), null, "2026-08-02")).toBe(2);
  });
});

describe("volumeBars", () => {
  it("малює всі дні періоду, а не тільки знайдені", () => {
    const bars = volumeBars(
      week,
      "2026-07-27",
      "2026-08-02",
      "day",
      "2026-08-01",
    );
    expect(bars).toHaveLength(7);
    // Середа порожня — вона мусить бути видимою прогалиною, а не зникнути.
    expect(bars.map((bar) => bar.value)).toEqual([20, 24, 0, 11, 18, 11, 0]);
  });

  it("підписує сім стовпчиків днями тижня", () => {
    const bars = volumeBars(
      week,
      "2026-07-27",
      "2026-08-02",
      "day",
      "2026-08-01",
    );
    expect(bars.map((bar) => bar.tick)).toEqual([
      "пн",
      "вт",
      "ср",
      "чт",
      "пт",
      "сб",
      "нд",
    ]);
  });

  it("на місяці підписує кожен сьомий день, а не всі 31", () => {
    const bars = volumeBars(
      week,
      "2026-07-01",
      "2026-07-31",
      "day",
      "2026-07-29",
    );
    expect(bars).toHaveLength(31);
    expect(
      bars.filter((bar) => bar.tick !== null).map((bar) => bar.tick),
    ).toEqual(["1", "8", "15", "22", "29"]);
  });

  it("групує по місяцях і підписує їх без точки", () => {
    const rows: DayRow[] = [
      { day: "2026-06-14", new_count: 0, review_count: 7, is_goal_met: false },
      { day: "2026-07-27", new_count: 5, review_count: 20, is_goal_met: true },
      { day: "2026-07-28", new_count: 5, review_count: 24, is_goal_met: true },
    ];
    const bars = volumeBars(
      rows,
      "2026-06-01",
      "2026-08-01",
      "month",
      "2026-08-01",
    );
    expect(bars.map((bar) => bar.value)).toEqual([7, 44, 0]);
    // «лип.» під стовпчиком читалось би як крапка на осі.
    expect(bars.map((bar) => bar.tick)).toEqual(["черв", "лип", "серп"]);
  });

  it("проходить через грудень, коли період перетинає рік", () => {
    const bars = volumeBars(
      [],
      "2026-11-01",
      "2027-02-01",
      "month",
      "2027-02-01",
    );
    expect(bars.map((bar) => bar.key)).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
      "2027-02-01",
    ]);
  });

  it("позначає поточний відрізок, і на добовій, і на місячній смужці", () => {
    const byDay = volumeBars(
      week,
      "2026-07-27",
      "2026-08-02",
      "day",
      "2026-07-30",
    );
    expect(byDay.filter((bar) => bar.now).map((bar) => bar.key)).toEqual([
      "2026-07-30",
    ]);

    const byMonth = volumeBars(
      week,
      "2026-06-01",
      "2026-08-01",
      "month",
      "2026-07-30",
    );
    expect(byMonth.filter((bar) => bar.now).map((bar) => bar.key)).toEqual([
      "2026-07-01",
    ]);
  });

  it("порожній період не дає стовпчиків і не зациклюється", () => {
    expect(
      volumeBars(week, "2026-08-05", "2026-08-02", "day", "2026-08-02"),
    ).toEqual([]);
  });
});

describe("firstDay", () => {
  it("знаходить найраніший день незалежно від порядку", () => {
    expect(firstDay(week)).toBe("2026-07-27");
    expect(firstDay([...week].reverse())).toBe("2026-07-27");
  });

  it("порожня історія — null, а не сьогодні", () => {
    expect(firstDay([])).toBeNull();
  });
});
