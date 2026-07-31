/**
 * «Сьогодні» — головний екран.
 *
 * Одна дія, потім підбиття, потім те, що зроблено. Кнопка «Вчити» — єдине, за
 * чим сюди заходять по десять разів на день; під нею тиждень і дві смужки
 * цілей, а в самому низу — слова, додані за добу, тими самими рядками, що в
 * словнику.
 *
 * Заголовків розділів тут немає навмисно. Раніше екран ділився на «Повторення»
 * і «Поповнення», але поділ був потрібен верстці, а не людині: смужка,
 * підписана «повторення», не стає зрозумілішою від заголовка «Повторення» над
 * нею.
 *
 * Числа тут не вигадуються: нові слова беруться з `/study/today/`, повторення —
 * з локального лічильника (він знає про відповіді, які ще не доїхали), довжина
 * черги — з останньої вибірки або з буфера, коли мережі немає.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { GearIcon, Screen } from "../ui/parts";
import { plural } from "../ui/plural";
import { localDay, resolveTimeZone } from "../study/day";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { progressValue } from "../study/session";
import { useSettings, useStudy, useToday, useWeek } from "../study/queries";
import { useAddedToday } from "../vocabulary/queries";
import CardRow from "../vocabulary/CardRow";
import StudyAimPanel from "../study/StudyAimPanel";
import { init, refill } from "../study/store";
import { unlockSpeech } from "../tts/speech";

const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

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
  const location = useLocation();
  const online = useOnline();
  const study = useStudy();
  const [aimOpen, setAimOpen] = useState(false);

  const settings = useSettings();
  const today = useToday();
  const week = useWeek(settings.data?.timezone);

  useEffect(() => {
    void init().then(() => {
      // Свіжі лічильники потрібні саме тут: кнопка «Вчити N» — єдине місце, де
      // видно всю чергу, а не її порцію. Це ж поповнення ловить повернення з
      // «Налаштувань»: екран перемонтовується, і черга приїжджає під новий
      // вибір груп.
      if (navigator.onLine) void refill();
    });
  }, []);

  const timeZone = resolveTimeZone(settings.data?.timezone);
  const day = localDay(new Date(), timeZone);
  const added = useAddedToday(day, timeZone);

  // Знімок — не запасний варіант «на всяк випадок», а те, що показується при
  // офлайн-відкритті. Без нього екран був би порожній при повному буфері поруч.
  const todayData = today.data ?? study.snapshotToday;
  const weekData = week.data ?? study.snapshotDays;

  const waiting = online
    ? Math.max(study.dueCount + study.newCount, study.buffer.length)
    : study.buffer.length;

  // Вибір щойно змінили, і черга ще летить. Це не «все повторено» — це «ще не
  // знаю». Показати тут нуль означало б збрехати рівно в ту мить, коли людина
  // дивиться, чи спрацював її вибір.
  const counting = study.refilling && waiting === 0;

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

  const addedCards = added.data ?? [];

  return (
    <Screen
      eyebrow={todayCaption(timeZone)}
      title="Сьогодні"
      aside={<ProfileAvatar />}
    >
      {/* Герой екрана. Число — не підпис на кнопці, а сама кнопка: у навчання
          заходять по десять разів на день, і цілитись у нього не має бути в що.
          Стрічка сяйва рухається тільки тут.

          Шестерня — сестра кнопки, а не її частина: кнопка всередині кнопки
          недопустима в розмітці. Стоїть вона в правому кінці нижньої полички,
          тобто рівно там, де закінчується рядок, який вона й дозволяє змінити. */}
      <div className="hero-wrap">
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
          {counting ? (
            <>
              <span className="hero-lbl">вчити</span>
              <span className="hero-word">Рахую…</span>
            </>
          ) : waiting > 0 ? (
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
              <span className="hero-sub">Забуті слова повернуться сьогодні ж.</span>
            </>
          )}
        </button>

        <button
          className={aimOpen ? "hero-gear open" : "hero-gear"}
          type="button"
          aria-label="Налаштування навчання"
          aria-expanded={aimOpen}
          aria-controls="aim-panel"
          onClick={() => setAimOpen((value) => !value)}
        >
          <GearIcon />
        </button>
      </div>

      <StudyAimPanel open={aimOpen} />

      {waiting === 0 && !counting && !online ? (
        <p className="hint hint-center">Потрібен звʼязок: збережених карток немає.</p>
      ) : null}

      {study.pending > 0 ? (
        <p className="hint hint-center">
          {study.pending}{" "}
          {study.pending === 1 ? "відповідь чекає" : "відповідей чекають"} на
          відправку
        </p>
      ) : null}

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

      <div className="goals">
        <GoalBar
          label="повторення"
          done={reviewsDone}
          goal={todayData?.review_goal ?? 0}
        />
        <GoalBar
          label="нові слова"
          done={todayData?.new_added ?? 0}
          goal={todayData?.new_goal ?? 0}
        />
      </div>

      {/* Слова, додані за добу, — усі, і рядками словника. Це хвіст екрана,
          нижче нема нічого, тож довга прокрутка тут нічого не відсуває: у день,
          коли додав двадцять слів, довгий хвіст і є те, на що дивишся.

          Порожнього підписаного блоку не буває: у день, коли нічого не додав,
          лишається сама кругла кнопка — і це запрошення, а не дірка. */}
      {addedCards.length > 0 ? (
        <div className="v-list today-added">
          {addedCards.map((card) => (
            <CardRow
              key={card.id}
              card={card}
              onOpen={() =>
                navigate(`/vocabulary/cards/${card.id}`, {
                  state: { background: location },
                })
              }
            />
          ))}
        </div>
      ) : null}

      <button
        className="v-add"
        type="button"
        disabled={!online}
        title={online ? "Додати слово" : "Потрібен звʼязок"}
        onClick={() =>
          // Без `activeListId`: на «Сьогодні» відкритого списку немає, і
          // `defaultListFor` сам підставить список за замовчуванням. Вибір груп
          // на це не впливає — він про читання черги, а не про запис.
          navigate("/vocabulary/cards/new", { state: { background: location } })
        }
      >
        +
      </button>
    </Screen>
  );
}
