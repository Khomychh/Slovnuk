/**
 * Що береться в чергу: групи слів і напрямок показу.
 *
 * Чисті функції живуть окремо від екрана «Налаштування» з однієї причини: їх
 * можна прочитати й перевірити, не тягнучи за собою React. Порядок рядків тут —
 * не оформлення, а правило, у якому є виняток ціною зниклого зі списку вибору.
 */

import type { StudyDirection, WordListPage } from "../api/study";
import type { Aim } from "./session";

export const DIRECTIONS: { value: StudyDirection; label: string }[] = [
  { value: "en_uk", label: "англ → укр" },
  { value: "uk_en", label: "укр → англ" },
  { value: "mixed", label: "змішано" },
];

/** Рядок вибору: справжній список або «Без списку», який списком не є. */
export type Row = {
  /** `null` — «Без списку»: id в нього немає й бути не може. */
  id: number | null;
  name: string;
  dueCount: number;
  picked: boolean;
};

export function aimRows(aim: Aim, lists: WordListPage | undefined): Row[] {
  const items: Row[] = (lists?.items ?? []).map((item) => ({
    id: item.id as number | null,
    name: item.name,
    dueCount: item.due_count,
    picked: aim.listIds.includes(item.id),
  }));
  // «Без списку» стоїть серед рядків, а не осторонь: у виборі це така сама
  // купка карток, як будь-яка інша. Осібність його — у тому, що в нього немає
  // id, і це видно рівно там, де важить: у самому виборі.
  if (lists?.unlisted && lists.unlisted.card_count > 0) {
    items.push({
      id: null,
      name: "без списку",
      dueCount: lists.unlisted.due_count,
      picked: aim.unlisted,
    });
  }
  return items;
}

/**
 * Порядок рядків.
 *
 * Спершу те, з чого сьогодні є що показати, за спаданням лічильника: групи
 * обирають, щоб учитись зараз, а не щоб оглянути словник. Решта йде в хвіст.
 *
 * Виняток, без якого все це не працює: **обраний рядок у хвіст не падає
 * ніколи**. Список, який ти вибрав учора, сьогодні може дійти до нуля — і
 * зникнувши з очей, він виглядав би не як порожній, а як утрачений, тоді як
 * черга далі береться саме з нього.
 */
export function splitRows(rows: Row[]): { hot: Row[]; cold: Row[] } {
  const hot = rows
    .filter((row) => row.dueCount > 0 || row.picked)
    .sort((a, b) => b.dueCount - a.dueCount);
  const cold = rows.filter((row) => row.dueCount === 0 && !row.picked);
  return { hot, cold };
}
