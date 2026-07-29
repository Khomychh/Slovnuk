/**
 * «Сьогодні» — головний екран.
 *
 * Велика кнопка «Вчити N», дві смужки денних цілей, сім крапок тижня, згорнутий
 * вибір списків і згорнутий напрямок.
 *
 * Числа тут не вигадуються: нові слова беруться з `/study/today/`, повторення —
 * з локального лічильника (він знає про відповіді, які ще не доїхали), довжина
 * черги — з останньої вибірки або з буфера, коли мережі немає.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { Screen } from "../ui/parts";
import { plural } from "../ui/plural";
import { localDay, resolveTimeZone } from "../study/day";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { progressValue } from "../study/session";
import { useLists, useSettings, useStudy, useToday, useUpdateSettings, useWeek } from "../study/queries";
import { init, refill, setListFilter } from "../study/store";
import { unlockSpeech } from "../tts/speech";
import type { StudyDirection } from "../api/study";

const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

const DIRECTIONS: { value: StudyDirection; label: string }[] = [
  { value: "en_uk", label: "англ → укр" },
  { value: "uk_en", label: "укр → англ" },
  { value: "mixed", label: "змішано" },
];

function todayCaption(timeZone: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

/**
 * Смужка денної цілі.
 *
 * Ціль 0 означає «вимкнено» — тоді смужки немає взагалі, лишається саме число.
 * Малювати порожню смужку до нуля було б брехнею: вона виглядала б як
 * невиконана ціль.
 */
function GoalBar({
  label,
  done,
  goal,
}: {
  label: string;
  done: number;
  goal: number;
}) {
  const met = goal > 0 && done >= goal;
  const percent = goal > 0 ? Math.min(100, Math.round((done / goal) * 100)) : 0;

  return (
    <div className="goal">
      <div className="goal-head">
        <span className="goal-label">{label}</span>
        <span className="goal-num">
          {goal > 0 ? (
            <>
              <b>{done}</b> / {goal}
            </>
          ) : (
            <b>{done}</b>
          )}
          {goal === 0 ? <span className="goal-off"> ціль вимкнено</span> : null}
        </span>
      </div>
      {goal > 0 ? (
        <div className="goal-track">
          <i className={met ? "on met" : "on"} style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export default function TodayScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const study = useStudy();

  const settings = useSettings();
  const today = useToday();
  const week = useWeek(settings.data?.timezone);
  const lists = useLists();
  const updateSettings = useUpdateSettings();

  const [listsOpen, setListsOpen] = useState(false);

  useEffect(() => {
    void init().then(() => {
      // Свіжі лічильники потрібні саме тут: кнопка «Вчити N» — єдине місце, де
      // видно всю чергу, а не її порцію.
      if (navigator.onLine) void refill();
    });
  }, []);

  const timeZone = resolveTimeZone(settings.data?.timezone);
  const day = localDay(new Date(), timeZone);

  // Знімок — не запасний варіант «на всяк випадок», а те, що показується при
  // офлайн-відкритті. Без нього екран був би порожній при повному буфері поруч.
  const todayData = today.data ?? study.snapshotToday;
  const weekData = week.data ?? study.snapshotDays;

  const waiting = online
    ? Math.max(study.dueCount + study.newCount, study.buffer.length)
    : study.buffer.length;

  const reviewsDone = progressValue(study.progress);

  const dots = useMemo(() => {
    const rows = new Map((weekData?.items ?? []).map((row) => [row.day, row]));
    return week.days.map((key, index) => {
      const row = rows.get(key);
      return {
        key,
        short: WEEKDAY_SHORT[index],
        isToday: key === day,
        // «Активність була» — це не те саме, що «ціль виконана». Порожній день
        // і день, у який учився, але не добрав до цілі, мусять виглядати різно.
        active: Boolean(row && (row.new_count > 0 || row.review_count > 0)),
        met: Boolean(row?.is_goal_met),
      };
    });
  }, [weekData, week.days, day]);

  const selected = study.listFilter;
  const listItems = lists.data?.items ?? [];
  const listLabel =
    selected.length === 0
      ? "усі списки"
      : selected.length === 1
        ? (listItems.find((item) => item.id === selected[0])?.name ?? "1 список")
        : `${selected.length} списків`;

  const toggleList = (id: number) => {
    const next = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id];
    void setListFilter(next);
  };

  return (
    <Screen
      eyebrow={todayCaption(timeZone)}
      title="Сьогодні"
      aside={<ProfileAvatar />}
    >
      {/* Герой екрана. Число — не підпис на кнопці, а сама кнопка: у навчання
          заходять по десять разів на день, і цілитись у нього не має бути в що.
          Стрічка сяйва рухається тільки тут. */}
      <button
        className="hero aurora aurora-live"
        type="button"
        disabled={waiting === 0}
        onClick={() => {
          // Єдиний жест, після якого починається автоозвучення, — саме цей.
          // На iOS без нього перша картка (і всі наступні) не пролунали б:
          // подробиці в `unlockSpeech`. На Android виклик не робить нічого.
          unlockSpeech();
          navigate("/study");
        }}
      >
        {waiting > 0 ? (
          <>
            <span className="hero-lbl">вчити</span>
            <span className="hero-num">{waiting}</span>
            <span className="hero-sub">
              {online
                ? `${study.dueCount} ${plural(study.dueCount, "повторення", "повторення", "повторень")} · ${study.newCount} ${plural(study.newCount, "нове", "нових", "нових")}`
                : `${study.buffer.length} ${plural(study.buffer.length, "картка збережена", "картки збережені", "карток збережено")}`}
            </span>
          </>
        ) : (
          <>
            <span className="hero-lbl">черга порожня</span>
            <span className="hero-word">Все повторено</span>
            <span className="hero-sub">
              Забуті слова повернуться сьогодні ж — черга поповнюється сама.
            </span>
          </>
        )}
      </button>

      {waiting === 0 && !online ? (
        <p className="hint hint-center">
          Збережених карток немає. Потрібен звʼязок, щоб завантажити чергу.
        </p>
      ) : null}

      {study.pending > 0 ? (
        <p className="hint hint-center">
          {study.pending} {study.pending === 1 ? "відповідь чекає" : "відповідей чекають"} на
          відправку
        </p>
      ) : null}

      <div className="goals">
        <GoalBar
          label="нові слова"
          done={todayData?.new_added ?? 0}
          goal={todayData?.new_goal ?? 0}
        />
        <GoalBar
          label="повторення"
          done={reviewsDone}
          goal={todayData?.review_goal ?? 0}
        />
      </div>

      <div className="week" aria-label="Тиждень">
        {dots.map((dot) => (
          <div key={dot.key} className="week-day">
            <span
              className={[
                "dot",
                dot.met ? "dot-met" : dot.active ? "dot-active" : "",
                dot.isToday ? "dot-today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
            <span className="week-lbl">{dot.short}</span>
          </div>
        ))}
      </div>

      {/* Вибір списків живе тільки на клієнті: це «що я вчу зараз», а не
          налаштування користувача. Але змінити його офлайн не можна — нову
          вибірку нема звідки взяти, і застосунок лишився б без карток. */}
      <details
        className="fold"
        open={listsOpen}
        onToggle={(event) => setListsOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="fold-label">списки</span>
          <span className="fold-value">{listLabel}</span>
        </summary>
        {online ? (
          <div className="fold-body">
            <button
              className={selected.length === 0 ? "chip chip-on" : "chip"}
              type="button"
              onClick={() => void setListFilter([])}
            >
              усі списки
            </button>
            {listItems.map((item) => (
              <button
                key={item.id}
                className={selected.includes(item.id) ? "chip chip-on" : "chip"}
                type="button"
                onClick={() => toggleList(item.id)}
              >
                {item.name}
                <span className="chip-num">{item.due_count}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="fold-body">
            <p className="hint">Змінити списки можна лише зі звʼязком.</p>
          </div>
        )}
      </details>

      <details className="fold">
        <summary>
          <span className="fold-label">напрямок</span>
          <span className="fold-value">
            {DIRECTIONS.find((item) => item.value === settings.data?.study_direction)
              ?.label ?? "—"}
          </span>
        </summary>
        <div className="fold-body">
          {online ? (
            DIRECTIONS.map((item) => (
              <button
                key={item.value}
                className={
                  settings.data?.study_direction === item.value ? "chip chip-on" : "chip"
                }
                type="button"
                disabled={updateSettings.isPending}
                onClick={() => updateSettings.mutate({ study_direction: item.value })}
              >
                {item.label}
              </button>
            ))
          ) : (
            <p className="hint">Змінити напрямок можна лише зі звʼязком.</p>
          )}
        </div>
      </details>
    </Screen>
  );
}
