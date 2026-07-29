/**
 * Підпис інтервалу.
 *
 * Числа беруться з `RatingPreviewSchema` — це секунди. Перевіряється передусім
 * український відмінок: «за 1 хвилину», «за 2 хвилини», «за 5 хвилин» — три
 * різні форми, і помилка тут видна кожному користувачеві щодня.
 */

import { describe, expect, it } from "vitest";
import { humanInterval, nextShowLabel, plural, secondsUntil } from "./format";

describe("plural", () => {
  it("бере правильну форму", () => {
    expect(plural(1, "день", "дні", "днів")).toBe("день");
    expect(plural(2, "день", "дні", "днів")).toBe("дні");
    expect(plural(5, "день", "дні", "днів")).toBe("днів");
  });

  it("не плутається на 11–14", () => {
    expect(plural(11, "день", "дні", "днів")).toBe("днів");
    expect(plural(12, "день", "дні", "днів")).toBe("днів");
    expect(plural(14, "день", "дні", "днів")).toBe("днів");
  });

  it("не плутається на другому десятку і далі", () => {
    expect(plural(21, "день", "дні", "днів")).toBe("день");
    expect(plural(22, "день", "дні", "днів")).toBe("дні");
    expect(plural(25, "день", "дні", "днів")).toBe("днів");
    expect(plural(111, "день", "дні", "днів")).toBe("днів");
  });
});

describe("humanInterval", () => {
  it("хвилини — саме те, заради чого прогноз їде в секундах", () => {
    // Перша відповідь на нове слово: сервер повертає його через 1 і 10 хвилин.
    // У днях обидва числа були б нулями.
    expect(humanInterval(60)).toBe("за 1 хвилину");
    expect(humanInterval(600)).toBe("за 10 хвилин");
    expect(humanInterval(120)).toBe("за 2 хвилини");
  });

  it("зовсім короткий інтервал не показує «за 0 хвилин»", () => {
    expect(humanInterval(0)).toBe("менш ніж за хвилину");
    expect(humanInterval(30)).toBe("менш ніж за хвилину");
  });

  it("переходить на години, а не показує «за 120 хвилин»", () => {
    expect(humanInterval(2 * 3600)).toBe("за 2 години");
    expect(humanInterval(5 * 3600)).toBe("за 5 годин");
  });

  it("дні", () => {
    expect(humanInterval(86400)).toBe("за 1 день");
    expect(humanInterval(4 * 86400)).toBe("за 4 дні");
    expect(humanInterval(12 * 86400)).toBe("за 12 днів");
  });

  it("переходить на місяці", () => {
    expect(humanInterval(60 * 86400)).toBe("за 2 місяці");
    expect(humanInterval(150 * 86400)).toBe("за 5 місяців");
  });

  it("переходить на роки", () => {
    expect(humanInterval(365 * 86400)).toBe("за 1 рік");
    expect(humanInterval(2 * 365 * 86400)).toBe("за 2 роки");
  });

  it("рік із половиною не стає «1.0 року»", () => {
    expect(humanInterval(Math.round(1.5 * 365 * 86400))).toBe("за 1.5 року");
  });
});

describe("nextShowLabel", () => {
  it("складається в речення", () => {
    expect(nextShowLabel(12 * 86400)).toBe("наступного разу — за 12 днів");
  });
});

describe("secondsUntil", () => {
  it("рахує від моменту відповіді до due_at", () => {
    const now = new Date("2026-07-28T10:00:00Z");
    expect(secondsUntil("2026-07-28T10:10:00Z", now)).toBe(600);
  });

  it("прострочене не стає відʼємним", () => {
    const now = new Date("2026-07-28T10:00:00Z");
    expect(secondsUntil("2026-07-28T09:00:00Z", now)).toBe(0);
  });
});
