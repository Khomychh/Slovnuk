import { describe, expect, it } from "vitest";
import {
  blankSense,
  type Card,
  type CardDraft,
  defaultListFor,
  deletionLosesHistory,
  distinctTranscriptions,
  draftIsDirty,
  newDraft,
  senseSummary,
  toCardPayload,
  toDraft,
} from "./card";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    word: "go",
    comment: null,
    forms_drill_enabled: true,
    created_at: "2026-07-28T10:00:00Z",
    list_ids: [4],
    senses: [],
    forms: [],
    tracks: [],
    ...overrides,
  } as Card;
}

function sense(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    part_of_speech: null,
    translation: null,
    gloss: null,
    transcription: null,
    examples: [],
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Тіло запиту — найнебезпечніше місце блоку
// --------------------------------------------------------------------------

describe("toCardPayload", () => {
  it("зберігає id значень і прикладів, щоб сервер оновлював, а не перестворював", () => {
    const draft = toDraft(
      card({
        senses: [
          sense({
            id: 7,
            translation: "йти",
            examples: [{ id: 3, text_en: "I go home.", text_uk: "Я йду додому." }],
          }),
        ],
        forms: [{ id: 9, label: "Past", value: "went", transcription: null }],
      }),
    );

    const payload = toCardPayload(draft);

    expect(payload.senses?.[0]).toMatchObject({ id: 7, translation: "йти" });
    expect(payload.senses?.[0]?.examples?.[0]).toMatchObject({ id: 3 });
    expect(payload.forms?.[0]).toMatchObject({ id: 9, value: "went" });
  });

  it("нові діти їдуть без id — інакше сервер відповів би 422", () => {
    const draft = newDraft([]);
    draft.senses[0]!.translation = "нове";

    const payload = toCardPayload(draft);

    expect(payload.senses?.[0]).not.toHaveProperty("id");
  });

  it("порожнє значення не доходить до сервера", () => {
    const draft = newDraft([]);
    // Користувач натиснув «+ значення» і передумав: жодного поля не заповнено.
    draft.senses = [blankSense()];

    expect(toCardPayload(draft).senses).toEqual([]);
  });

  it("значення без перекладу, але з транскрипцією, порожнім НЕ вважається", () => {
    // Живий випадок зі словника: «that is why» — перекладу немає, решта є.
    const draft = newDraft([]);
    draft.senses = [{ ...blankSense(), transcription: "ðæt ɪz waɪ" }];

    expect(toCardPayload(draft).senses).toHaveLength(1);
  });

  it("форма без значення відкидається, навіть якщо мітка заповнена", () => {
    const draft = newDraft([]);
    draft.forms = [{ id: null, label: "Past", value: "  ", transcription: "" }];

    expect(toCardPayload(draft).forms).toEqual([]);
  });

  it("приклад без англійського речення відкидається разом із перекладом", () => {
    const draft = newDraft([]);
    draft.senses[0]!.translation = "йти";
    draft.senses[0]!.examples = [{ id: null, textEn: "  ", textUk: "Я йду." }];

    expect(toCardPayload(draft).senses?.[0]?.examples).toEqual([]);
  });

  it("стерті всі значення дають порожній масив, а не відсутнє поле", () => {
    // Це і є семантика «стерти все» в CardUpdateSchema. Якби поле зникало,
    // сервер лишив би старі значення, і кнопка «прибрати» мовчки не працювала б.
    const draft = toDraft(card({ senses: [sense({ translation: "йти" })] }));
    draft.senses = [];

    const payload = toCardPayload(draft);
    expect(payload).toHaveProperty("senses");
    expect(payload.senses).toEqual([]);
  });

  it("порожній текст стає null, а не порожнім рядком", () => {
    const draft = newDraft([]);
    draft.comment = "   ";
    draft.senses[0]!.translation = "  йти  ";

    const payload = toCardPayload(draft);
    expect(payload.comment).toBeNull();
    expect(payload.senses?.[0]?.translation).toBe("йти");
  });
});

// --------------------------------------------------------------------------
// Куди кладеться нова картка
// --------------------------------------------------------------------------

describe("defaultListFor", () => {
  const own = [1, 2, 3];

  it("активний фільтр важливіший за список за замовчуванням", () => {
    expect(defaultListFor(2, 1, own)).toEqual([2]);
  });

  it("без фільтра береться список за замовчуванням", () => {
    expect(defaultListFor(null, 1, own)).toEqual([1]);
  });

  it("без фільтра і без дефолту картка створюється без списку", () => {
    expect(defaultListFor(null, null, own)).toEqual([]);
  });

  it("видалений список за замовчуванням не підставляється", () => {
    // FK обнуляє позначку сам, але кеш налаштувань може відстати на хвилину.
    expect(defaultListFor(null, 99, own)).toEqual([]);
  });

  it("фільтр «Без списку» не вважається списком", () => {
    expect(defaultListFor(null, 3, own)).toEqual([3]);
  });
});

// --------------------------------------------------------------------------
// Попередження при видаленні
// --------------------------------------------------------------------------

describe("deletionLosesHistory", () => {
  it("картка, яку жодного разу не показували, історії не має", () => {
    const subject = card({
      tracks: [{ id: 1, kind: "translation", state: "new", due_at: "2026-07-28T10:00:00Z" }],
    } as Partial<Card>);

    expect(deletionLosesHistory(subject)).toBe(false);
  });

  it("будь-яка доріжка поза станом new означає втрату review_logs", () => {
    const subject = card({
      tracks: [
        { id: 1, kind: "translation", state: "new", due_at: "2026-07-28T10:00:00Z" },
        { id: 2, kind: "forms", state: "review", due_at: "2026-08-28T10:00:00Z" },
      ],
    } as Partial<Card>);

    expect(deletionLosesHistory(subject)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Підпис рядка
// --------------------------------------------------------------------------

describe("senseSummary", () => {
  it("склеює переклади з короткою частиною мови", () => {
    const subject = card({
      senses: [
        sense({ id: 1, translation: "бігти", part_of_speech: "v" }),
        sense({ id: 2, translation: "забіг", part_of_speech: "n" }),
      ],
    });

    expect(senseSummary(subject)).toBe("бігти (дієсл.); забіг (ім.)");
  });

  it("значення без перекладу в підпис не потрапляє", () => {
    const subject = card({
      senses: [
        sense({ id: 1, translation: null, transcription: "ðæt" }),
        sense({ id: 2, translation: "тому" }),
      ],
    });

    expect(senseSummary(subject)).toBe("тому");
  });

  it("картка без перекладів дає порожній підпис, а не «undefined»", () => {
    expect(senseSummary(card())).toBe("");
  });
});

describe("distinctTranscriptions", () => {
  it("та сама вимова у двох значеннях показується один раз", () => {
    const subject = card({
      senses: [
        sense({ id: 1, transcription: "rʌn" }),
        sense({ id: 2, transcription: "rʌn" }),
      ],
    });

    expect(distinctTranscriptions(subject)).toEqual(["rʌn"]);
  });
});

// --------------------------------------------------------------------------
// Незбережені зміни
// --------------------------------------------------------------------------

describe("draftIsDirty", () => {
  const base: CardDraft = newDraft([1]);

  it("нічого не міняли — питати нічого", () => {
    expect(draftIsDirty(base, newDraft([1]))).toBe(false);
  });

  it("додали і прибрали порожнє значення — це не зміна", () => {
    // Інакше кожне випадкове натискання «+ значення» породжувало б питання
    // «зберегти зміни?» там, де змін немає.
    const after = newDraft([1]);
    after.senses.push(blankSense());

    expect(draftIsDirty(base, after)).toBe(false);
  });

  it("змінений переклад — це зміна", () => {
    const after = newDraft([1]);
    after.senses[0]!.translation = "йти";

    expect(draftIsDirty(base, after)).toBe(true);
  });

  it("зміна списків — теж зміна", () => {
    expect(draftIsDirty(base, newDraft([2]))).toBe(true);
  });
});
