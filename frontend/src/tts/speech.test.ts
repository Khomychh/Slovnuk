/**
 * Правила озвучення.
 *
 * Тут перевіряється рівно те, що не видно живим браузером на одній машині:
 * поведінка на чужому наборі голосів. На айфоні англійських голосів шість і
 * все виглядає правильно завжди; на Android із єдиним пакетом «English (US)»
 * британська кнопка мусить погаснути, а збережений на сервері британський
 * акцент — озвучитись тим голосом, який є, а не промовчати.
 *
 * Друга половина — правило автоозвучення: слово звучить рівно тоді, коли
 * англійське слово вперше видно. Помилка тут не падає, а тихо озвучує
 * відповідь на лицьовій стороні «укр → англ», тобто псує саму вправу.
 */

import { describe, expect, it } from "vitest";
import type { CardSide, QueueItem } from "../study/session";
import {
  accentAvailable,
  autoplayText,
  englishVoices,
  pickVoice,
  type VoiceLike,
} from "./speech";

const voice = (name: string, lang: string): VoiceLike => ({ name, lang });

/** iPhone: англійських голосів багато, регіони справжні. */
const IPHONE = [
  voice("Milena", "ru-RU"),
  voice("Samantha", "en-US"),
  voice("Daniel", "en-GB"),
  voice("Karen", "en-AU"),
];

/** Android із єдиним завантаженим пакетом. Підкреслення в мітці — не описка. */
const ANDROID_US_ONLY = [voice("Google українська", "uk-UA"), voice("English", "en_US")];

const card = (word: string): QueueItem["card"] => ({
  id: 1,
  word,
  comment: null,
  forms_drill_enabled: true,
  senses: [],
  forms: [],
});

function item(kind: QueueItem["kind"], word = "go"): QueueItem {
  return {
    track_id: 1,
    kind,
    state: "review",
    due_at: "2026-07-29T10:00:00Z",
    card: card(word),
    preview: { again: 60, hard: 600, good: 86400, easy: 345600 },
  };
}

describe("englishVoices", () => {
  it("лишає тільки англійські", () => {
    expect(englishVoices(IPHONE).map((v) => v.name)).toEqual([
      "Samantha",
      "Daniel",
      "Karen",
    ]);
  });

  it("розуміє мітку з підкресленням — так їх пише Android", () => {
    expect(englishVoices(ANDROID_US_ONLY).map((v) => v.name)).toEqual(["English"]);
  });

  it("не плутає англійську з іншою мовою, що починається на en", () => {
    expect(englishVoices([voice("Enya", "eng-GB"), voice("X", "enz")])).toEqual([]);
  });
});

describe("accentAvailable", () => {
  it("на iPhone доступні всі три", () => {
    expect(accentAvailable(IPHONE, "auto")).toBe(true);
    expect(accentAvailable(IPHONE, "us")).toBe(true);
    expect(accentAvailable(IPHONE, "gb")).toBe(true);
  });

  it("на Android з одним пакетом британського голосу немає", () => {
    expect(accentAvailable(ANDROID_US_ONLY, "auto")).toBe(true);
    expect(accentAvailable(ANDROID_US_ONLY, "us")).toBe(true);
    expect(accentAvailable(ANDROID_US_ONLY, "gb")).toBe(false);
  });

  it("без англійських голосів недоступне ніщо, зокрема «Авто»", () => {
    expect(accentAvailable([voice("Milena", "ru-RU")], "auto")).toBe(false);
    expect(accentAvailable([], "us")).toBe(false);
  });

  it("голос без регіону (просто en) не видає себе за британський", () => {
    const plain = [voice("English", "en")];
    expect(accentAvailable(plain, "auto")).toBe(true);
    expect(accentAvailable(plain, "gb")).toBe(false);
  });
});

describe("pickVoice", () => {
  it("бере голос потрібного регіону", () => {
    expect(pickVoice(IPHONE, "gb")?.name).toBe("Daniel");
    expect(pickVoice(IPHONE, "us")?.name).toBe("Samantha");
  });

  it("«Авто» — перший англійський, а не перший у списку", () => {
    expect(pickVoice(IPHONE, "auto")?.name).toBe("Samantha");
  });

  it("відкочується на наявний англійський, а не мовчить", () => {
    // Британський акцент, збережений на іншому пристрої. Промовчати тут гірше,
    // ніж сказати слово американським голосом.
    expect(pickVoice(ANDROID_US_ONLY, "gb")?.name).toBe("English");
  });

  it("без англійських голосів не вигадує неанглійського", () => {
    expect(pickVoice([voice("Milena", "ru-RU")], "auto")).toBeNull();
    expect(pickVoice([], "gb")).toBeNull();
  });
});

describe("autoplayText", () => {
  const en: CardSide = "en_uk";
  const uk: CardSide = "uk_en";

  it("«англ → укр»: слово звучить на лицьовій", () => {
    expect(autoplayText(item("translation"), en, false)).toBe("go");
  });

  it("«англ → укр»: при розкритті вдруге не звучить", () => {
    expect(autoplayText(item("translation"), en, true)).toBeNull();
  });

  it("«укр → англ»: на лицьовій мовчить — інакше це відповідь уголос", () => {
    expect(autoplayText(item("translation"), uk, false)).toBeNull();
  });

  it("«укр → англ»: слово звучить у момент розкриття", () => {
    expect(autoplayText(item("translation"), uk, true)).toBe("go");
  });

  it("доріжка форм: звучить слово на лицьовій, форми — ніколи", () => {
    expect(autoplayText(item("forms"), en, false)).toBe("go");
    expect(autoplayText(item("forms"), en, true)).toBeNull();
  });

  it("доріжка форм тримається свого обличчя, а не сторони показу", () => {
    // `cardSide` віддає для форм "en_uk", але обличчя будується по `kind`.
    // Якщо колись напрямок почне впливати на форми, зламається саме цей тест.
    expect(autoplayText(item("forms"), uk, false)).toBe("go");
    expect(autoplayText(item("forms"), uk, true)).toBeNull();
  });

  it("порожнє слово не озвучується", () => {
    expect(autoplayText(item("translation", "   "), en, false)).toBeNull();
  });

  it("зайві пробіли не їдуть у синтез", () => {
    expect(autoplayText(item("translation", "  go  "), en, false)).toBe("go");
  });
});
