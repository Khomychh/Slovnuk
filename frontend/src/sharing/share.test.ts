import { describe, expect, it } from "vitest";
import {
  alreadyHave,
  buildShareUrl,
  importFoundNothing,
  importSummary,
  needsMode,
  overwriteWarning,
  ownerLine,
  previewHeadline,
  previewNote,
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

describe("головне речення", () => {
  it("частина слів нових — називає обидва числа", () => {
    // Саме та правда, без якої імпорт виглядає зламаним: зі списку на 50 слів
    // додається 38.
    expect(previewHeadline(preview(50, 38))).toBe("Додасться 38 із 50 слів");
  });

  it("усі слова нові — одне число", () => {
    expect(previewHeadline(preview(50, 50))).toBe("Додасться 50 слів");
  });

  it("нових немає — каже це прямо, а не «додасться 0»", () => {
    expect(previewHeadline(preview(12, 0))).toBe("Усі ці слова у вас уже є");
  });

  it("порожній список", () => {
    expect(previewHeadline(preview(0, 0))).toBe("У цьому списку немає слів");
  });

  it("одне слово — відмінок правильний", () => {
    expect(previewHeadline(preview(1, 1))).toBe("Додасться 1 слово");
  });

  it("двадцять два слова — не «22 слів»", () => {
    expect(previewHeadline(preview(22, 22))).toBe("Додасться 22 слова");
  });
});

describe("уточнення під головним реченням", () => {
  it("збігів немає — уточнювати нічого", () => {
    expect(previewNote(preview(50, 50))).toBeNull();
  });

  it("один збіг — однина", () => {
    expect(previewNote(preview(50, 49))).toBe("1 слово у вас уже є — його імпорт не чіпає.");
  });

  it("дванадцять збігів — множина", () => {
    expect(previewNote(preview(50, 38))).toBe("12 слів у вас уже є — їх імпорт не чіпає.");
  });
});

describe("підпис автора", () => {
  it("імʼя є", () => {
    expect(ownerLine("Іван")).toBe("Поділився Іван");
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
    expect(buildShareUrl("https://slovnuk.ivankhomych.com", "AbC123")).toBe(
      "https://slovnuk.ivankhomych.com/shares/AbC123",
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
