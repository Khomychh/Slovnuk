/**
 * Температура доріжки.
 *
 * Перевіряються насамперед МЕЖІ. Вони дзеркалять `STABILITY_BAND_EDGES` на
 * бекенді, а розходження на один знак означало б, що те саме слово світиться на
 * «Прогресі» й на картці різними кольорами — і зрозуміти це буде нічим: обидва
 * екрани виглядатимуть правдоподібно.
 */

import { describe, expect, it } from "vitest";
import { cardTemperature, temperature } from "./temperature";
import type { components } from "../api/schema";

type Track = components["schemas"]["CardTrackSchema"];

function track(kind: Track["kind"], stability: number | null): Track {
  return {
    id: 1,
    kind,
    state: stability === null ? "new" : "review",
    due_at: "2026-08-01T00:00:00Z",
    stability,
  };
}

describe("temperature", () => {
  it("нове слово — найхолодніша зупинка", () => {
    // Не нуль: у NEW стабільності ще НЕМАЄ, і нуль означав би «тримається
    // менше дня», чого про нове слово не відомо.
    expect(temperature(null)).toBe("var(--a0)");
    expect(temperature(undefined)).toBe("var(--a0)");
  });

  it("розкладає стабільність на шість зупинок", () => {
    expect(temperature(0.4)).toBe("var(--a1)"); // до 1 дня
    expect(temperature(3.1)).toBe("var(--a2)"); // 1–6 днів
    expect(temperature(21)).toBe("var(--a3)"); // 6–30 днів
    expect(temperature(95)).toBe("var(--a4)"); // 30–180 днів
    expect(temperature(310)).toBe("var(--a5)"); // понад 180 днів
  });

  it("межі строгі — рівно на межі слово вже в теплішому діапазоні", () => {
    // Той самий бік, що й у SQL: `stability < edge`. Шість днів — це вже
    // «вивчено» (LEARNED_STABILITY_DAYS), а не «майже».
    expect(temperature(0.999)).toBe("var(--a1)");
    expect(temperature(1)).toBe("var(--a2)");
    expect(temperature(5.999)).toBe("var(--a2)");
    expect(temperature(6)).toBe("var(--a3)");
    expect(temperature(29.999)).toBe("var(--a3)");
    expect(temperature(30)).toBe("var(--a4)");
    expect(temperature(179.999)).toBe("var(--a4)");
    expect(temperature(180)).toBe("var(--a5)");
  });
});

describe("cardTemperature", () => {
  it("бере доріжку перекладу, а не форм", () => {
    // Інакше вимкнення тренування форм тихо міняло б колір картки.
    const tracks = [track("forms", 300), track("translation", 2)];
    expect(cardTemperature(tracks)).toBe("var(--a2)");
  });

  it("картка без доріжки перекладу вважається новою", () => {
    expect(cardTemperature([])).toBe("var(--a0)");
    expect(cardTemperature([track("forms", 300)])).toBe("var(--a0)");
  });
});
