/**
 * Локальне правило показу і денний лічильник.
 *
 * Правило описане в ADR-0007, а те, що воно діє завжди (а не лише офлайн), — в
 * ADR-0010. Лічильник дзеркалить `count_reviewed_tracks` на бекенді:
 * COUNT(DISTINCT track_id), а не кількість натискань.
 */

import { describe, expect, it } from "vitest";
import {
  AGAIN_GAP,
  aimIsAll,
  aimKey,
  applyCardEdit,
  applyRating,
  cardSide,
  countAnswer,
  dropCard,
  emptyProgress,
  mergeIncoming,
  progressValue,
  sameAim,
  syncProgress,
  type QueueItem,
} from "./session";

/** Доріжка з рівно тими полями, які читає правило. Решта тут ні на що не впливає. */
function track(id: number): QueueItem {
  return {
    track_id: id,
    kind: "translation",
    state: "review",
    due_at: "2026-07-28T10:00:00Z",
    stability: 12,
    card: {
      id: id * 10,
      word: `word-${id}`,
      comment: null,
      forms_drill_enabled: true,
      senses: [],
      forms: [],
    },
    preview: { again: 60, hard: 600, good: 86400, easy: 345600 },
  };
}

const ids = (buffer: QueueItem[]) => buffer.map((item) => item.track_id);

describe("applyRating", () => {
  it("«Добре» прибирає картку", () => {
    expect(ids(applyRating([track(1), track(2), track(3)], 3))).toEqual([2, 3]);
  });

  it("«Легко» прибирає картку так само", () => {
    expect(ids(applyRating([track(1), track(2), track(3)], 4))).toEqual([2, 3]);
  });

  it("«Важко» відсуває картку в кінець буфера", () => {
    expect(ids(applyRating([track(1), track(2), track(3)], 2))).toEqual([2, 3, 1]);
  });

  it("«Не згадав» повертає картку через три інші", () => {
    const buffer = [track(1), track(2), track(3), track(4), track(5), track(6)];
    expect(ids(applyRating(buffer, 1))).toEqual([2, 3, 4, 1, 5, 6]);
  });

  it("«Не згадав» ставить у кінець, коли трьох інших карток немає", () => {
    // Рівно AGAIN_GAP карток — вставляти «через три» немає куди, і хвіст
    // збігається з кінцем.
    expect(ids(applyRating([track(1), track(2), track(3), track(4)], 1))).toEqual([
      2, 3, 4, 1,
    ]);
    expect(ids(applyRating([track(1), track(2)], 1))).toEqual([2, 1]);
  });

  it("остання забута картка показується знову, а не завершує навчання", () => {
    expect(ids(applyRating([track(1)], 1))).toEqual([1]);
  });

  it("остання згадана картка спорожняє буфер", () => {
    expect(applyRating([track(1)], 3)).toEqual([]);
  });

  it("не змінює вхідний буфер", () => {
    const buffer = [track(1), track(2)];
    applyRating(buffer, 1);
    expect(ids(buffer)).toEqual([1, 2]);
  });

  it("порожній буфер лишається порожнім", () => {
    expect(applyRating([], 3)).toEqual([]);
  });

  it("між забутою карткою і її поверненням рівно AGAIN_GAP інших", () => {
    const buffer = Array.from({ length: 10 }, (_, i) => track(i + 1));
    const after = applyRating(buffer, 1);
    expect(after.findIndex((item) => item.track_id === 1)).toBe(AGAIN_GAP);
  });
});

describe("mergeIncoming", () => {
  it("додає тільки те, чого в буфері немає", () => {
    const buffer = [track(1), track(2)];
    const incoming = [track(2), track(3)];
    expect(ids(mergeIncoming(buffer, incoming))).toEqual([1, 2, 3]);
  });

  it("не повертає доріжку, відповідь на яку ще в черзі відправки", () => {
    // Сервер про цю відповідь ще не знає, тож доріжка й далі виглядає
    // простроченою і приїде у вибірці. Пустити її в буфер означало б показати
    // картку двічі за сесію.
    const buffer = [track(1)];
    const incoming = [track(2), track(3)];
    expect(ids(mergeIncoming(buffer, incoming, [2]))).toEqual([1, 3]);
  });

  it("не переставляє наявний порядок", () => {
    // Локальне правило вже щось про нього вирішило — свіжа вибірка не має
    // права це чіпати.
    const buffer = [track(3), track(1), track(2)];
    expect(ids(mergeIncoming(buffer, [track(1), track(4)]))).toEqual([3, 1, 2, 4]);
  });

  it("не дублює повторів усередині самої вибірки", () => {
    expect(ids(mergeIncoming([], [track(1), track(1)]))).toEqual([1]);
  });

  it("повертає той самий масив, коли додавати нема чого", () => {
    const buffer = [track(1)];
    expect(mergeIncoming(buffer, [track(1)])).toBe(buffer);
  });
});

describe("cardSide", () => {
  const forms = { ...track(1), kind: "forms" as const };

  it("доріжка форм завжди йде від слова до форм", () => {
    expect(cardSide(forms, "uk_en", 1)).toBe("en_uk");
    expect(cardSide(forms, "mixed", 1)).toBe("en_uk");
  });

  it("однобічне налаштування діє як є", () => {
    expect(cardSide(track(1), "en_uk", 7)).toBe("en_uk");
    expect(cardSide(track(1), "uk_en", 7)).toBe("uk_en");
  });

  it("при «змішано» картка не міняє бік між показами", () => {
    // Забуту картку покажуть удруге через три інші. Якби бік тягнули з
    // Math.random(), це була б уже інша вправа.
    const first = cardSide(track(42), "mixed", 99);
    expect(cardSide(track(42), "mixed", 99)).toBe(first);
    expect(cardSide(track(42), "mixed", 99)).toBe(first);
  });

  it("при «змішано» дає обидва боки, а не один", () => {
    const sides = new Set(
      Array.from({ length: 60 }, (_, i) => cardSide(track(i + 1), "mixed", 5)),
    );
    expect(sides).toEqual(new Set(["en_uk", "uk_en"]));
  });

  it("наступна сесія розкладає боки інакше", () => {
    const withSeed = (seed: number) =>
      Array.from({ length: 40 }, (_, i) => cardSide(track(i + 1), "mixed", seed)).join();
    expect(withSeed(1)).not.toBe(withSeed(2));
  });
});

describe("денний лічильник", () => {
  const DAY = "2026-07-28";

  it("рахує різні доріжки, а не натискання", () => {
    // Одна доріжка з кроками навчання дає 2–3 відповіді за день. Якби тут
    // рахувались натискання, цифра розійшлася б із /today/ удвічі-втричі.
    let progress = emptyProgress(DAY);
    progress = countAnswer(progress, 7, DAY); // «Не згадав»
    progress = countAnswer(progress, 7, DAY); // за три картки — «Важко»
    progress = countAnswer(progress, 7, DAY); // ще раз — «Добре»
    expect(progressValue(progress)).toBe(1);
  });

  it("додається до числа, яке віддав сервер", () => {
    let progress = syncProgress(12, DAY);
    progress = countAnswer(progress, 1, DAY);
    progress = countAnswer(progress, 2, DAY);
    expect(progressValue(progress)).toBe(14);
  });

  it("обнуляється при переході доби посеред сесії", () => {
    let progress = syncProgress(29, DAY);
    progress = countAnswer(progress, 1, DAY);
    expect(progressValue(progress)).toBe(30);

    progress = countAnswer(progress, 2, "2026-07-29");
    expect(progressValue(progress)).toBe(1);
    expect(progress.day).toBe("2026-07-29");
  });

  it("та сама доріжка зараховується знову наступного дня", () => {
    let progress = countAnswer(emptyProgress(DAY), 7, DAY);
    progress = countAnswer(progress, 7, "2026-07-29");
    expect(progressValue(progress)).toBe(1);
  });

  it("синхронізація скидає локальну дельту, а не додає її до серверної", () => {
    // Найлегша помилка: узяти нове число сервера і лишити дельту. Тоді
    // відповіді, які сервер уже порахував, порахуються вдруге.
    let progress = syncProgress(10, DAY);
    progress = countAnswer(progress, 1, DAY);
    progress = countAnswer(progress, 2, DAY);
    expect(progressValue(progress)).toBe(12);

    progress = syncProgress(12, DAY);
    expect(progressValue(progress)).toBe(12);
    expect(progress.localTracks).toEqual([]);
  });
});

// --- правка картки просто в навчанні ---

/** Доріжка форм тієї самої картки, що й `track(id)`: card.id збігається. */
function formsTrack(id: number, cardId: number): QueueItem {
  return {
    ...track(id),
    kind: "forms",
    card: { ...track(id).card, id: cardId, forms: [
      { id: 1, label: "Past", value: "went", transcription: null },
    ] },
  };
}

const edited = (cardId: number, word: string, forms: QueueItem["card"]["forms"] = []) => ({
  id: cardId,
  word,
  comment: null,
  forms_drill_enabled: true,
  senses: [],
  forms,
});

describe("applyCardEdit", () => {
  it("підміняє вміст усіх доріжок картки, не чіпаючи чужі", () => {
    const buffer = [track(1), track(2)];
    const next = applyCardEdit(buffer, edited(10, "виправлено"));

    expect(next.map((item) => item.card.word)).toEqual(["виправлено", "word-2"]);
    expect(ids(next)).toEqual([1, 2]);
  });

  it("не переставляє порядок", () => {
    const buffer = [track(1), track(2), track(3)];
    const next = applyCardEdit(buffer, edited(20, "нове"));
    expect(ids(next)).toEqual([1, 2, 3]);
  });

  it("прибирає доріжку форм, коли тренування вимкнули", () => {
    const buffer = [track(1), formsTrack(9, 10)];
    const next = applyCardEdit(buffer, {
      ...edited(10, "go", [{ id: 1, label: "Past", value: "went", transcription: null }]),
      forms_drill_enabled: false,
    });

    expect(ids(next)).toEqual([1]);
  });

  it("прибирає доріжку форм, коли форми стерли всі до одної", () => {
    // Тренування лишилось увімкненим, але тренувати вже нічого.
    const buffer = [formsTrack(9, 10), track(2)];
    const next = applyCardEdit(buffer, edited(10, "go", []));
    expect(ids(next)).toEqual([2]);
  });

  it("доріжку перекладу не прибирає ніколи", () => {
    // Картку зберегли зовсім без значень — вона все одно лишається карткою.
    const buffer = [track(1)];
    const next = applyCardEdit(buffer, edited(10, "go", []));
    expect(ids(next)).toEqual([1]);
  });
});

describe("dropCard", () => {
  it("забирає обидві доріжки видаленої картки", () => {
    const buffer = [track(1), formsTrack(9, 10), track(2)];
    // track(1).card.id === 10, і доріжка форм має той самий card.id.
    expect(ids(dropCard(buffer, 10))).toEqual([2]);
  });

  it("картки, якої в буфері немає, не помічає", () => {
    const buffer = [track(1), track(2)];
    expect(ids(dropCard(buffer, 999))).toEqual([1, 2]);
  });
});

describe("вибір груп", () => {
  it("порожній вибір означає «усі слова», а не «жодного»", () => {
    expect(aimIsAll({ listIds: [], unlisted: false })).toBe(true);
  });

  it("«без списку» сам по собі — це вже вибір, а не порожнеча", () => {
    // Без цього вибір «вчу тільки те, що без списку» мовчки перетворювався б
    // на «вчу все»: списків у ньому справді нема.
    expect(aimIsAll({ listIds: [], unlisted: true })).toBe(false);
  });

  it("порядок списків вибору не міняє", () => {
    // Інакше перевибір тих самих списків в іншому порядку викидав би повний
    // буфер і слав зайву вибірку на 50 карток.
    expect(
      sameAim({ listIds: [7, 3], unlisted: false }, { listIds: [3, 7], unlisted: false }),
    ).toBe(true);
  });

  it("«без списку» відрізняє вибори з тими самими списками", () => {
    expect(
      sameAim({ listIds: [3], unlisted: true }, { listIds: [3], unlisted: false }),
    ).toBe(false);
  });

  it("ключ порожнього вибору не збігається з ключем «лише без списку»", () => {
    // Ключем звіряють, чи годиться збережений буфер. Збіг тут означав би, що
    // після перезапуску людина побачила б картки з усього словника там, де
    // вибрала лише картки без списку.
    expect(aimKey({ listIds: [], unlisted: false })).not.toBe(
      aimKey({ listIds: [], unlisted: true }),
    );
  });
});
