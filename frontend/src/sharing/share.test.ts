import { describe, expect, it } from "vitest";
import {
  alreadyHave,
  buildShareUrl,
  canImport,
  importFoundNothing,
  importLabel,
  importSummary,
  needsMode,
  overwriteWarning,
  ownerLine,
} from "./share";

/** Зведення до імпорту — рівно ті два числа, з яких усе рахується. */
function preview(total: number, fresh: number) {
  return { total_cards: total, new_cards: fresh };
}

describe("скільки слів уже є", () => {
  it("різниця між усіма й новими", () => {
    expect(alreadyHave(preview(50, 38))).toBe(12);
  });

  it("нових більше за всі — нуль, а не відʼємне", () => {
    // Такого бути не мусить, але порахувати «−3 слова у вас уже є» гірше, ніж
    // показати нуль: перше видно користувачу як поломку.
    expect(alreadyHave(preview(10, 13))).toBe(0);
  });
});

describe("перемикач режиму", () => {
  it("збігів немає — перемикача немає", () => {
    // Без збігів skip і overwrite роблять те саме, і кнопка «Замінити» була б
    // органом керування без наслідку.
    expect(needsMode(preview(50, 50))).toBe(false);
  });

  it("є хоч один збіг — перемикач потрібен", () => {
    expect(needsMode(preview(50, 49))).toBe(true);
  });

  it("порожній список — перемикача немає", () => {
    expect(needsMode(preview(0, 0))).toBe(false);
  });
});

describe("підпис кнопки взяття", () => {
  it("пропуск — називає, скільки справді додасться", () => {
    expect(importLabel(preview(50, 38), "skip")).toBe("Взяти 38 слів");
    expect(importLabel(preview(1, 1), "skip")).toBe("Взяти 1 слово");
    expect(importLabel(preview(22, 22), "skip")).toBe("Взяти 22 слова");
  });

  it("пропуск і нових немає — каже причину, а не «Взяти 0 слів»", () => {
    expect(importLabel(preview(12, 0), "skip")).toBe("Усі слова вже є");
  });

  it("заміна — називає обидві дії", () => {
    expect(importLabel(preview(50, 38), "overwrite")).toBe("Взяти 38 слів і замінити 12");
    expect(importLabel(preview(12, 0), "overwrite")).toBe("Замінити 12 слів");
  });

  it("заміна без збігів — те саме, що пропуск", () => {
    expect(importLabel(preview(50, 50), "overwrite")).toBe("Взяти 50 слів");
  });

  it("порожній список", () => {
    expect(importLabel(preview(0, 0), "skip")).toBe("У списку немає слів");
  });
});

describe("чи є що брати", () => {
  it("пропуск без нових — нічого", () => {
    expect(canImport(preview(12, 0), "skip")).toBe(false);
  });

  it("заміна без нових — є: вміст карток зміниться", () => {
    expect(canImport(preview(12, 0), "overwrite")).toBe(true);
  });

  it("порожній список — нічого в жодному режимі", () => {
    expect(canImport(preview(0, 0), "skip")).toBe(false);
    expect(canImport(preview(0, 0), "overwrite")).toBe(false);
  });
});

describe("підпис автора", () => {
  it("імʼя є", () => {
    expect(ownerLine("Андрій")).toBe("Поділився Андрій");
  });

  it("імені немає — підпису немає, а не «Поділився null»", () => {
    expect(ownerLine(null)).toBeNull();
    expect(ownerLine(undefined)).toBeNull();
    expect(ownerLine("   ")).toBeNull();
  });
});

describe("попередження перед заміною", () => {
  const text = overwriteWarning(12);

  it("називає число", () => {
    expect(text).toContain("12 слів");
  });

  it("каже, що зникне", () => {
    expect(text).toContain("Ваші переклади зникнуть");
  });

  it("каже, що прогрес НЕ зникне", () => {
    // Без цього речення користувач відмовляється від режиму зі страху втратити
    // повторення — а вони живуть на картці, не на її тексті.
    expect(text).toContain("Прогрес повторень залишиться");
  });
});

describe("звіт після імпорту", () => {
  it("усі три числа, коли всі три ненульові", () => {
    expect(importSummary({ created: 38, overwritten: 0, skipped: 12 })).toBe(
      "додано 38 слів · пропущено 12 слів.",
    );
  });

  it("заміна показується окремо від додавання", () => {
    expect(importSummary({ created: 5, overwritten: 12, skipped: 0 })).toBe(
      "додано 5 слів · замінено 12 слів.",
    );
  });

  it("нулі не показуються", () => {
    expect(importSummary({ created: 1, overwritten: 0, skipped: 0 })).toBe(
      "додано 1 слово.",
    );
  });

  it("порожній результат — речення, а не порожній рядок", () => {
    expect(importSummary({ created: 0, overwritten: 0, skipped: 0 })).toBe(
      "Список порожній — додавати було нічого.",
    );
  });
});

describe("порожній результат — не помилка", () => {
  it("списку не створено", () => {
    expect(importFoundNothing({ list_id: null })).toBe(true);
  });

  it("список створено", () => {
    expect(importFoundNothing({ list_id: 7 })).toBe(false);
  });
});

describe("адреса посилання", () => {
  it("будується з origin браузера", () => {
    expect(buildShareUrl("https://slovnuk.example.com", "AbC123")).toBe(
      "https://slovnuk.example.com/shares/AbC123",
    );
  });

  it("у розробці origin інший, і це нормально", () => {
    expect(buildShareUrl("http://localhost:5173", "AbC123")).toBe(
      "http://localhost:5173/shares/AbC123",
    );
  });

  it("зайвий слеш в origin не дає подвійного", () => {
    expect(buildShareUrl("https://example.com/", "t")).toBe(
      "https://example.com/shares/t",
    );
  });
});
