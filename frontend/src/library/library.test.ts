/**
 * Тести текстів Бібліотеки.
 *
 * Помилка тут не падає, а бреше: «Додасться 540 слів» замість «495 із 540» —
 * це не збій, це неправда, за якою людина ухвалює рішення. Тому накриті всі
 * межі, а не «щасливий шлях».
 */

import { describe, expect, it } from "vitest";
import {
  alreadyHave,
  asOfLine,
  authorLine,
  canPublish,
  derivedLine,
  ratingLine,
  skippedPreview,
  stalenessLine,
  takeFoundNothing,
  takeHeadline,
  takeNote,
  takeSummary,
  updatedLine,
} from "./library";

describe("ratingLine", () => {
  it("нижче порогу не каже НІЧОГО — ні числа, ні слів", () => {
    // Відсутність рейтингу сама є інформацією: порожнє місце праворуч читається
    // швидше за «поки без оцінок». `null`, а не рядок-заглушка, — щоб тип
    // змушував кожне місце показу вирішити це свідомо.
    expect(ratingLine({ rating: null, ratings_count: 0 })).toBeNull();
    expect(ratingLine({ rating: null, ratings_count: 2 })).toBeNull();
  });

  it("вирівнює цілий рейтинг до однієї десятої", () => {
    // Сервер віддає 5.0, JSON робить із цього 5 — без toFixed поруч стояли б
    // «4.6» і «5», що читається як різна точність.
    expect(ratingLine({ rating: 5, ratings_count: 3 })).toBe("5.0 ★ (3)");
    expect(ratingLine({ rating: 4.6, ratings_count: 31 })).toBe("4.6 ★ (31)");
  });
});

describe("takeHeadline", () => {
  it("порожній список називає порожнім, а не «додасться 0»", () => {
    expect(takeHeadline({ cards_count: 0, new_cards: 0 })).toBe(
      "У цьому списку немає слів",
    );
  });

  it("усі слова наявні — головне речення каже саме це", () => {
    expect(takeHeadline({ cards_count: 540, new_cards: 0 })).toBe(
      "Усі ці слова у вас уже є",
    );
  });

  it("нічого не пропускається — одне число", () => {
    expect(takeHeadline({ cards_count: 540, new_cards: 540 })).toBe(
      "Додасться 540 слів",
    );
  });

  it("частина пропускається — обидва числа, бо різниця і є суттю", () => {
    expect(takeHeadline({ cards_count: 540, new_cards: 495 })).toBe(
      "Додасться 495 із 540 слів",
    );
  });
});

describe("alreadyHave", () => {
  it("рахує різницю й не йде в мінус", () => {
    expect(alreadyHave({ cards_count: 540, new_cards: 495 })).toBe(45);
    // Захист від суперечливої відповіді сервера: мінус тут перетворився б на
    // «-3 слова у вас уже є».
    expect(alreadyHave({ cards_count: 10, new_cards: 13 })).toBe(0);
  });
});

describe("takeNote", () => {
  it("молчить, коли пропускати нічого", () => {
    expect(takeNote({ cards_count: 540, new_cards: 540 })).toBeNull();
  });

  it("одне слово відмінює в однині", () => {
    expect(takeNote({ cards_count: 10, new_cards: 9 })).toBe(
      "1 слово у вас уже є — його взяття не чіпає.",
    );
  });

  it("багато слів відмінює в множині", () => {
    expect(takeNote({ cards_count: 540, new_cards: 495 })).toBe(
      "45 слів у вас уже є — їх взяття не чіпає.",
    );
  });
});

describe("authorLine", () => {
  it("порожній автор означає видалений акаунт, а не незаповнений профіль", () => {
    // Без імені й прізвища опублікувати не можна взагалі, тож null тут може
    // означати лише те, що автор пішов.
    expect(authorLine(null)).toBe("автор пішов");
    expect(authorLine("   ")).toBe("автор пішов");
    expect(authorLine(undefined)).toBe("автор пішов");
  });

  it("імʼя віддає як є", () => {
    expect(authorLine("Іван Хомич")).toBe("Іван Хомич");
  });
});

describe("derivedLine", () => {
  it("без походження нічого не малює", () => {
    expect(derivedLine(null)).toBeNull();
    expect(derivedLine("  ")).toBeNull();
  });

  it("називає оригінал", () => {
    expect(derivedLine("Фразові для B1")).toBe("росте з «Фразові для B1»");
  });
});

describe("updatedLine", () => {
  it("у межах року рік не пише — він з'їдає рядок ні за що", () => {
    const line = updatedLine("2026-07-30T10:00:00Z", new Date("2026-08-15T00:00:00Z"));
    expect(line).toBe("оновлено 30 липня");
  });

  it("інший рік дописує", () => {
    const line = updatedLine("2025-03-04T10:00:00Z", new Date("2026-08-15T00:00:00Z"));
    expect(line).toContain("2025");
  });

  it("сміттєву дату не показує зовсім", () => {
    // Порожній рядок краще за «оновлено Invalid Date» у витрині.
    expect(updatedLine("не дата")).toBe("");
  });
});

describe("asOfLine", () => {
  it("каже «станом на», а не «оновлено» — це та сама дата про інше", () => {
    // Читачеві важливо, що список ОНОВЛЮВАЛИ: свіжий вміст проти старих зірок.
    // Автору важливо протилежне — що в Бібліотеці лежить копія НА ЦЮ ДАТУ, а не
    // живий список. Раніше цю відмінність пояснював цілий абзац про знімок.
    const iso = "2026-07-30T10:00:00Z";
    const now = new Date("2026-08-15T00:00:00Z");
    expect(asOfLine(iso, now)).toBe("станом на 30 липня");
    expect(updatedLine(iso, now)).toBe("оновлено 30 липня");
  });

  it("інший рік дописує, як і сусідка", () => {
    expect(asOfLine("2025-03-04T10:00:00Z", new Date("2026-08-15T00:00:00Z"))).toContain(
      "2025",
    );
  });

  it("сміттєву дату не показує зовсім", () => {
    // «станом на Invalid Date» на екрані власника гірше за мовчання: воно
    // читалось би як зламана публікація.
    expect(asOfLine("не дата")).toBe("");
  });
});

describe("takeSummary", () => {
  it("порожній список — окреме речення, а не «додано 0 слів»", () => {
    expect(takeSummary({ created: 0, skipped: 0 })).toBe(
      "Список порожній — додавати було нічого.",
    );
  });

  it("називає обидва числа, коли обидва є", () => {
    expect(takeSummary({ created: 495, skipped: 45 })).toBe(
      "додано 495 слів · пропущено 45 слів.",
    );
  });

  it("нуль не показує", () => {
    expect(takeSummary({ created: 38, skipped: 0 })).toBe("додано 38 слів.");
    expect(takeSummary({ created: 0, skipped: 12 })).toBe("пропущено 12 слів.");
  });
});

describe("takeFoundNothing", () => {
  it("списку не створили — значить нічого не знайшлось", () => {
    expect(takeFoundNothing({ list_id: null })).toBe(true);
    expect(takeFoundNothing({ list_id: 7 })).toBe(false);
  });
});

describe("skippedPreview", () => {
  it("коротке показує цілком і нічого не ховає", () => {
    expect(skippedPreview(["run", "go"])).toEqual({
      shown: ["run", "go"],
      rest: 0,
    });
  });

  it("довге обрізає й чесно каже, скільки лишилось", () => {
    const many = Array.from({ length: 540 }, (_, index) => `word${index}`);
    const preview = skippedPreview(many);
    expect(preview.shown).toHaveLength(10);
    expect(preview.rest).toBe(530);
  });

  it("порожнє не дає ні слів, ні хвоста", () => {
    expect(skippedPreview([])).toEqual({ shown: [], rest: 0 });
  });
});

describe("canPublish", () => {
  it("порожній список публікувати нема сенсу — знімок вийшов би порожнім", () => {
    expect(canPublish(0)).toBe(false);
    expect(canPublish(1)).toBe(true);
  });
});

describe("stalenessLine", () => {
  it("однакові кількості — молчить", () => {
    // Це не «все актуально»: виправлений в одному слові переклад кількості не
    // змінює, і обіцяти актуальність ми не маємо права.
    expect(stalenessLine({ cards_count: 540, list_cards_count: 540 })).toBeNull();
  });

  it("у списку більше — каже, що оновлення щось додасть", () => {
    expect(stalenessLine({ cards_count: 540, list_cards_count: 545 })).toBe(
      "У списку на 5 слів більше, ніж у публікації.",
    );
  });

  it("у списку менше — теж каже, бо це теж розбіжність", () => {
    expect(stalenessLine({ cards_count: 540, list_cards_count: 495 })).toBe(
      "У списку на 45 слів менше, ніж у публікації.",
    );
  });

  it("одне слово відмінює правильно", () => {
    expect(stalenessLine({ cards_count: 10, list_cards_count: 11 })).toBe(
      "У списку на 1 слово більше, ніж у публікації.",
    );
  });

  it("список видалено — оновлювати нема з чого", () => {
    expect(stalenessLine({ cards_count: 540, list_cards_count: null })).toBe(
      "Список видалено — оновити публікацію вже нема з чого.",
    );
  });
});
