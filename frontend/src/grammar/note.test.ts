import { describe, expect, it } from "vitest";
import {
  blankDraft,
  categorySuggestions,
  draftIsDirty,
  filterNotes,
  matchesQuery,
  snippet,
  titleProblem,
  toDraft,
  toNotePayload,
  CATEGORY_SUGGESTION_LIMIT,
  type Note,
  type NoteCategory,
} from "./note";

function note(patch: Partial<Note> = {}): Note {
  return {
    id: 1,
    title: "Make | Do",
    body_markdown: "- Make використовується, коли ми створюємо щось нове",
    position: 0,
    category_id: 3,
    category_name: "Особливі слова",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T10:00:00Z",
    ...patch,
  };
}

describe("тіло запиту", () => {
  /**
   * Клас помилки той самий, що `senses: []` у словнику: якщо очищене поле не
   * поїде на сервер, користувач побачить «збережено», а нотатка лишиться зі
   * старим тілом — і дізнається про це лише наступного відкриття.
   */
  it("порожнє тіло їде порожнім рядком, а не зникає з тіла запиту", () => {
    const payload = toNotePayload({ title: "Раз", category: "", body: "" });
    expect(payload).toHaveProperty("body_markdown");
    expect(payload.body_markdown).toBe("");
  });

  it("порожній розділ їде порожнім рядком — це «прибрати розділ»", () => {
    const payload = toNotePayload({ title: "Раз", category: "  ", body: "тіло" });
    expect(payload).toHaveProperty("category");
    expect(payload.category).toBe("");
  });

  it("обидва поля присутні завжди, навіть коли не мінялись", () => {
    const payload = toNotePayload(toDraft(note()));
    expect(Object.keys(payload).sort()).toEqual([
      "body_markdown",
      "category",
      "title",
    ]);
  });

  it("заголовок і розділ обрізаються з країв", () => {
    const payload = toNotePayload({
      title: "  Say | Tell  ",
      category: "  Особливі слова  ",
      body: "тіло",
    });
    expect(payload.title).toBe("Say | Tell");
    expect(payload.category).toBe("Особливі слова");
  });

  it("відступ на початку рядка тіла зберігається, хвостові порожні рядки — ні", () => {
    const payload = toNotePayload({
      title: "Раз",
      category: "",
      body: "  відступ значущий\n\n\n",
    });
    expect(payload.body_markdown).toBe("  відступ значущий");
  });
});

describe("незбережені зміни", () => {
  it("чернетка без правок не брудна", () => {
    const draft = toDraft(note());
    expect(draftIsDirty(draft, draft)).toBe(false);
  });

  it("самі лише хвостові пробіли брудною не роблять", () => {
    const initial = toDraft(note());
    expect(draftIsDirty(initial, { ...initial, title: `${initial.title}  ` })).toBe(
      false,
    );
  });

  it("очищення розділу — це зміна", () => {
    const initial = toDraft(note());
    expect(draftIsDirty(initial, { ...initial, category: "" })).toBe(true);
  });

  it("очищення тіла — це зміна", () => {
    const initial = toDraft(note());
    expect(draftIsDirty(initial, { ...initial, body: "" })).toBe(true);
  });
});

describe("заголовок", () => {
  it("порожній не приймається — бекенд дав би 422", () => {
    expect(titleProblem("")).not.toBeNull();
    expect(titleProblem("   ")).not.toBeNull();
  });

  it("звичайний приймається", () => {
    expect(titleProblem("As soon as")).toBeNull();
  });

  it("задовгий називає обидва числа", () => {
    const problem = titleProblem("я".repeat(300));
    expect(problem).toContain("300");
    expect(problem).toContain("255");
  });
});

describe("локальний пошук", () => {
  it("порожній запит пропускає все", () => {
    expect(matchesQuery(note(), "")).toBe(true);
    expect(matchesQuery(note(), "   ")).toBe(true);
  });

  it("шукає в заголовку", () => {
    expect(matchesQuery(note(), "make")).toBe(true);
  });

  it("шукає в тілі — саме заради цього довідник і потрібен", () => {
    // Старий PWA шукав нотатки лише за заголовком, хоч і показував уривок тіла.
    expect(matchesQuery(note(), "створюємо")).toBe(true);
  });

  it("регістр не має значення, зокрема в кирилиці", () => {
    expect(matchesQuery(note({ title: "Часи" }), "часи")).toBe(true);
    expect(matchesQuery(note({ title: "часи" }), "ЧАСИ")).toBe(true);
  });

  it("порожнє тіло пошуку не ламає", () => {
    expect(matchesQuery(note({ body_markdown: null }), "make")).toBe(true);
    expect(matchesQuery(note({ body_markdown: null }), "нема")).toBe(false);
  });

  it("filterNotes лишає лише збіги", () => {
    const notes = [
      note({ id: 1, title: "Make | Do" }),
      note({ id: 2, title: "Say | Tell", body_markdown: "Say — зосереджено на словах" }),
    ];
    expect(filterNotes(notes, "say").map((item) => item.id)).toEqual([2]);
  });
});

describe("уривок для списку", () => {
  it("знімає дефіс пункту", () => {
    expect(snippet("- Make використовується")).toBe("Make використовується");
  });

  it("знімає решітки заголовка", () => {
    expect(snippet("# Speak — більш офіційне")).toBe("Speak — більш офіційне");
  });

  it("знімає зірочки розмітки", () => {
    expect(snippet("При вживанні **to go** дія від нас")).toBe(
      "При вживанні to go дія від нас",
    );
  });

  it("бере перший НЕпорожній рядок", () => {
    expect(snippet("\n\n  друге життя\nтретій")).toBe("друге життя");
  });

  it("довгий уривок обрізається з трикрапкою", () => {
    const long = snippet("я".repeat(200));
    expect(long).toHaveLength(91);
    expect(long.endsWith("…")).toBe(true);
  });

  it("порожнє тіло дає порожній рядок", () => {
    expect(snippet("")).toBe("");
    expect(snippet(null)).toBe("");
    expect(snippet("   \n  ")).toBe("");
  });
});

describe("порожня чернетка", () => {
  it("розділ можна підставити наперед — з активного фільтра", () => {
    expect(blankDraft("Часи")).toEqual({ title: "", category: "Часи", body: "" });
  });

  it("без аргументу розділу немає", () => {
    expect(blankDraft().category).toBe("");
  });
});

function cat(name: string, note_count: number, id = 1): NoteCategory {
  return { id, name, position: 0, note_count };
}

describe("підказки розділів", () => {
  const many = [
    cat("Часи", 40, 1),
    cat("Артиклі", 12, 2),
    cat("Прийменники", 9, 3),
    cat("Прислівник", 5, 4),
    cat("Особливі слова", 4, 5),
    cat("Future Simple", 2, 6),
    cat("Модальні", 1, 7),
    cat("Порожній", 0, 8),
  ];

  it("порожнє поле дає найбільші розділи, а не перші за порядком", () => {
    const { names } = categorySuggestions(many, "");
    expect(names[0]).toBe("Часи");
    expect(names).toHaveLength(CATEGORY_SUGGESTION_LIMIT);
  });

  it("порожній розділ не займає місця в шістці, але й не зникає", () => {
    const { names, hidden } = categorySuggestions(many, "");
    expect(names).not.toContain("Порожній");
    expect(hidden).toBe(2);
    // Дістати його можна набором — розділ живий, доки його не видалили явно.
    expect(categorySuggestions(many, "порож").names).toEqual(["Порожній"]);
  });

  it("більше шести ніколи не показуємо", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => cat(`Розділ ${i}`, i, i));
    expect(categorySuggestions(fifty, "").names).toHaveLength(6);
    expect(categorySuggestions(fifty, "Розділ").hidden).toBe(44);
  });

  it("набране звужує перелік", () => {
    expect(categorySuggestions(many, "при").names).toEqual([
      "Прийменники",
      "Прислівник",
    ]);
  });

  it("шукає в будь-якому місці назви, не тільки на початку", () => {
    expect(categorySuggestions(many, "simple").names).toEqual(["Future Simple"]);
    expect(categorySuggestions(many, "слова").names).toEqual(["Особливі слова"]);
  });

  it("регістр не має значення при звуженні", () => {
    expect(categorySuggestions(many, "ЧАС").names).toEqual(["Часи"]);
    expect(categorySuggestions(many, "aRtI").names).toEqual([]);
    expect(categorySuggestions(many, "АРТИ").names).toEqual(["Артиклі"]);
  });

  /* Вибирати вже нема з чого, а рядок чипів під заповненим полем з'їдав би
     місце — і на телефоні саме те, куди стане клавіатура. */
  it("точний збіг гасить підказки", () => {
    expect(categorySuggestions(many, "Часи").names).toEqual([]);
    expect(categorySuggestions(many, "  часи  ").names).toEqual([]);
  });

  /* Бекенд зіставляє розділи без огляду на регістр (`find_category_by_name`),
     тож «ЧАСИ» потрапить у наявний «Часи», а не заведе другий. Підказка тут
     була б брехнею: вибирати справді нема з чого. */
  it("точний збіг рахується без регістру — як і на бекенді", () => {
    expect(categorySuggestions(many, "ЧАСИ").names).toEqual([]);
  });

  it("нова назва підказок не має", () => {
    expect(categorySuggestions(many, "Герундій").names).toEqual([]);
    expect(categorySuggestions(many, "Герундій").hidden).toBe(0);
  });

  it("без розділів взагалі нічого не пропонує", () => {
    expect(categorySuggestions([], "")).toEqual({ names: [], hidden: 0 });
  });
});
