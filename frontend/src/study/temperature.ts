/**
 * Температура доріжки — зупинка рампи сяйва за її стабільністю (ADR-0016).
 *
 * Межі тут не вигадані: це дзеркало `STABILITY_BAND_EDGES` із
 * `backend/app/cruds/vocabulary.py`, тих самих діапазонів, якими рахується
 * теплова смуга «Прогресу». Розійтись їм не можна — інакше на двох екранах
 * стояли б два різні визначення «наскільки міцно я це знаю», і одне з них
 * брехало б.
 *
 * Стабільність `null` — це стан NEW: величини ще немає. Нулем її підміняти не
 * можна, бо нуль означав би «тримається менше дня», а про нове слово нічого
 * такого не відомо.
 */

import type { components } from "../api/schema";

type Track = components["schemas"]["CardTrackSchema"];

/**
 * Діапазони від найхолоднішого до найтеплішого: до якої межі в днях і яким
 * кольором. Межі — дзеркало STABILITY_BAND_EDGES = (1.0, 6.0, 30.0, 180.0).
 */
const BANDS: { under: number; stop: string }[] = [
  { under: 1, stop: "var(--a1)" }, // до 1 дня
  { under: 6, stop: "var(--a2)" }, // 1–6 днів
  { under: 30, stop: "var(--a3)" }, // 6–30 днів
  { under: 180, stop: "var(--a4)" }, // 30–180 днів
];

/** Нове слово: стабільності ще немає. */
const NEW_STOP = "var(--a0)";

/** Понад 180 днів — золотий кінець рампи. */
const LONG_STOP = "var(--a5)";

/**
 * Стабільність у днях → колір сяйва.
 *
 * Порівняння строго «менше», як і в SQL-виразі на бекенді: рівно 6 днів — це вже
 * «вивчено», а не «майже». Розбіжність в один знак тут означала б, що слово на
 * межі світиться на екранах по-різному.
 */
export function temperature(stability: number | null | undefined): string {
  if (stability === null || stability === undefined) return NEW_STOP;
  return BANDS.find((band) => stability < band.under)?.stop ?? LONG_STOP;
}

/**
 * Температура картки — це температура доріжки ПЕРЕКЛАДУ.
 *
 * Той самий вибір, що в `learned` і в тепловій смузі, і з тієї ж причини:
 * інакше вимкнення тренування форм тихо міняло б колір картки, а картка без
 * форм була б у привілейованому становищі проти картки з формами.
 *
 * Доріжки перекладу немає лише в одному випадку — картка щойно приїхала, і
 * `tracks` ще порожній. Тоді це «нове».
 */
export function cardTemperature(tracks: Track[]): string {
  const translation = tracks.find((track) => track.kind === "translation");
  return temperature(translation?.stability);
}
