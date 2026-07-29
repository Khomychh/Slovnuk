/**
 * Панель обраного дня — те, що розкриває клітинка календаря.
 *
 * Єдине місце в застосунку, де видно, ЧОМУ день золотий або бірюзовий. Через це
 * цілі тут показані знаменником — і це не суперечить тому, що знаменник
 * прибрано з плиток (ADR-0018): там була частка днів періоду, тут виконання
 * цілі, яка того дня діяла.
 *
 * Цілі — знімок того дня, а не поточні. Підвищив ціль з 30 до 50 — учорашній
 * день, який був виконаний, лишається виконаним і показує ту планку, яка справді
 * стояла.
 *
 * Дня без активності в базі немає взагалі: рядок створюється при першій же дії
 * доби (`ensure_study_day`). Тому про такий день не відомо навіть цілей, і
 * вигадувати їх з поточних налаштувань не можна — сказати можна рівно «нічого
 * не було».
 */

import { plural } from "../ui/plural";
import type { DayKey } from "../study/day";

export type DayFacts = {
  new_goal: number;
  review_goal: number;
  new_count: number;
  review_count: number;
  is_goal_met: boolean;
};

/** «середа, 29 липня». Капс робить CSS — Intl віддає звичайний регістр. */
function dayTitle(day: DayKey): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${day}T00:00:00Z`));
}

export default function DayDetail({
  day,
  facts,
  isToday,
}: {
  day: DayKey;
  facts: DayFacts | undefined;
  isToday: boolean;
}) {
  return (
    <div className="pd dd">
      <div className="pd-head dd-head">
        <span>{dayTitle(day)}</span>
        {facts ? (
          <span
            className={facts.is_goal_met ? "dd-mark dd-mark-met" : "dd-mark"}
          >
            {facts.is_goal_met ? "виконано" : "не добрав"}
          </span>
        ) : null}
      </div>

      {facts ? (
        <>
          <div className="pd-row">
            <span className="pd-lbl">Повторено</span>
            <span className="pd-val">
              {facts.review_count}
              {/* Нульова ціль означає «вимкнено», а не «нуль» — знаменника
                  тоді немає, бо не з чим порівнювати. */}
              {facts.review_goal > 0 ? (
                <span className="pd-goal"> з {facts.review_goal}</span>
              ) : null}
            </span>
          </div>
          <div className="pd-row">
            <span className="pd-lbl">Додано</span>
            <span className="pd-val">
              {facts.new_count}
              {facts.new_goal > 0 ? (
                <span className="pd-goal"> з {facts.new_goal}</span>
              ) : null}
              {` ${plural(facts.new_count, "слово", "слова", "слів")}`}
            </span>
          </div>
        </>
      ) : (
        <p className="pd-empty">
          {isToday ? "Сьогодні ще нічого не було." : "Нічого не було."}
        </p>
      )}
    </div>
  );
}
