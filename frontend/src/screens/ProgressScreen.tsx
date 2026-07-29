/**
 * «Прогрес» — наскільки міцно тримається словник.
 *
 * Герой екрана — теплова смуга: ширина кожної зупинки дорівнює кількості слів
 * у ній. Одразу після імпорту вона буде суцільно холодною, і це не порожній
 * екран, а точка відліку (ADR-0004: прогрес зі старого PWA не переносився).
 *
 * Зупинки підписані тим, наскільки слово знаєш, а не діапазонами днів
 * (ADR-0018): «1–6 днів» поруч зі словником, де в кожного слова є дата
 * створення, читається як вік картки, а не як міцність памʼяті. Межі й кольори
 * при цьому ті самі — змінена тільки мова.
 *
 * Два числа поруч виглядають як помилка, доки їх не підписати одиницею: смуга
 * рахує ДОРІЖКИ ПЕРЕКЛАДУ, по одній на картку, тож її сума дорівнює кількості
 * слів; «на повторення» рахує ДОРІЖКИ, а картка з формами дає їх дві.
 *
 * Агрегати за періоди рахує клієнт із тієї самої вибірки `GET /study/days/`.
 * Ендпоінта `/days/summary/` немає навмисно: межі «тижня з понеділка» в поясі
 * користувача інакше жили б у двох реалізаціях і тихо розійшлися б. Самі
 * правила — у `study/period.ts`, під тестами: рахувати їх «на око» прямо тут
 * означало б, зокрема, що прогул склеював би дві серії в одну довгу.
 *
 * Плитки рахують ЗАКРИТІ ДНІ, а не обсяг роботи, і показують одне число без
 * знаменника (ADR-0018). Обсяг живе в панелі, яку плитка розкриває.
 *
 * Стан екрана — дві незалежні вибірки: обраний період і обраний день. Вони не
 * пов'язані навмисно: календар завжди показує поточний місяць і плиткам не
 * підкоряється, інакше на «рік» це був би вже інший віджет.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { Screen } from "../ui/parts";
import { useVocabularyStats } from "../vocabulary/queries";
import { fetchDays } from "../api/study";
import {
  daysInMonth,
  localDay,
  monthStart,
  resolveTimeZone,
} from "../study/day";
import {
  closedDays,
  firstDay,
  longestStreak,
  periodVolume,
  volumeBars,
} from "../study/period";
import { monthName, periodsFor, type PeriodKey } from "../progress/periods";
import PeriodDetail from "../progress/PeriodDetail";
import DayDetail from "../progress/DayDetail";
import { useSettings } from "../study/queries";

/**
 * Шість зупинок температури.
 *
 * Підписи від першої особи (ADR-0018). Межа між «пригадую» і «знаю» — це рівно
 * `LEARNED_STABILITY_DAYS = 6`, тобто означення «Вивчено»: до цієї зміни бекенд
 * його рахував, а фронтенд не показував ніде.
 *
 * Ключі — з `stability_bands` бекенду, і перейменовувати їх не можна: смуга
 * читає відповідь саме ними.
 */
const BANDS = [
  { key: "new", name: "не вчив", token: "--a0" },
  { key: "under_day", name: "ледь памʼятаю", token: "--a1" },
  { key: "days", name: "пригадую", token: "--a2" },
  { key: "weeks", name: "знаю", token: "--a3" },
  { key: "months", name: "добре знаю", token: "--a4" },
  { key: "long", name: "знаю назубок", token: "--a5" },
] as const;

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

export default function ProgressScreen() {
  const settings = useSettings();
  const timeZone = resolveTimeZone(settings.data?.timezone);
  const today = localDay(new Date(), timeZone);

  const stats = useVocabularyStats();

  // Обидві панелі закриті на вході. Відкрита плитка одразу відсунула б календар
  // за край екрана, а заходять сюди не тільки по деталі періоду.
  const [openPeriod, setOpenPeriod] = useState<PeriodKey | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  // Без from/to — уся історія. Вона починається з дня імпорту і за рік
  // залишиться сотнями рядків, а не тисячами: рядок за добу, не за відповідь.
  const days = useQuery({
    queryKey: ["study", "days", "all"],
    queryFn: () => fetchDays(),
    staleTime: 60_000,
  });

  const items = days.data?.items ?? [];

  const periods = useMemo(
    () => periodsFor(today, firstDay(items)),
    [items, today],
  );

  const counts = useMemo(
    () =>
      new Map(
        periods.map((period) => [
          period.key,
          closedDays(items, period.from, today),
        ]),
      ),
    [periods, items, today],
  );

  const detail = useMemo(() => {
    const slot = periods.findIndex((candidate) => candidate.key === openPeriod);
    const period = periods[slot];
    if (!period) return null;
    return {
      period,
      slot,
      volume: periodVolume(items, period.from, today),
      streak: longestStreak(items, period.from, today),
      bars: volumeBars(
        items,
        period.barsFrom,
        period.barsTo,
        period.unit,
        today,
      ),
    };
  }, [periods, openPeriod, items, today]);

  const rows = useMemo(
    () => new Map(items.map((row) => [row.day, row])),
    [items],
  );

  // Сітка місяця з понеділка. Порожні клітинки на початку — не «нульові дні»,
  // а чужий місяць, тому вони прозорі, а не сірі.
  const cells = useMemo(() => {
    const first = monthStart(today);
    const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
    const total = daysInMonth(today);

    const out: { key: string; day: string | null; cls: string }[] = [];
    for (let i = 0; i < lead; i += 1) {
      out.push({ key: `out-${i}`, day: null, cls: "cal-c out" });
    }
    for (let d = 1; d <= total; d += 1) {
      const key = `${first.slice(0, 8)}${String(d).padStart(2, "0")}`;
      const row = rows.get(key);
      const state = row?.is_goal_met
        ? "met"
        : row && (row.review_count > 0 || row.new_count > 0)
          ? "act"
          : "";
      out.push({
        key,
        // Майбутні дні лишаються клітинками, але не кнопками: про них не відомо
        // нічого, і тапати їх нема сенсу.
        day: key <= today ? key : null,
        cls: [
          "cal-c",
          state,
          key === today ? "now" : "",
          key === openDay ? "pick" : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    }
    return out;
  }, [rows, today, openDay]);

  const bands = stats.data?.stability_bands;

  return (
    <Screen title="Прогрес" aside={<ProfileAvatar />}>
      <div className="band" aria-label="Слова за тим, наскільки добре вивчені">
        {BANDS.map((band) => (
          <i
            key={band.key}
            style={{
              flexGrow: bands ? bands[band.key] : 1,
              // Саме backgroundColor, а не background: інакше воно затерло б
              // внутрішній градієнт світла з ui.css.
              backgroundColor: `var(${band.token})`,
            }}
          />
        ))}
      </div>

      <div className="legend">
        {BANDS.map((band) => (
          <div className="leg" key={band.key}>
            <span
              className="leg-sw"
              style={{ background: `var(${band.token})` }}
            />
            <span className="leg-n">{band.name}</span>
            <span className="leg-v">{bands ? bands[band.key] : "—"}</span>
          </div>
        ))}
      </div>

      <div className="eyebrow tiles-cap">Закриті дні</div>
      <div className="tiles" role="tablist" aria-label="Період">
        {periods.map((period) => {
          const on = period.key === openPeriod;
          return (
            <button
              className={on ? "tile tile-on" : "tile"}
              key={period.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setOpenPeriod(on ? null : period.key)}
            >
              <span className="tile-lbl">{period.label}</span>
              <span className="tile-num">{counts.get(period.key) ?? 0}</span>
            </button>
          );
        })}
      </div>

      {detail ? (
        <PeriodDetail
          period={detail.period}
          slot={detail.slot}
          volume={detail.volume}
          streak={detail.streak}
          bars={detail.bars}
        />
      ) : null}

      <div className="card-label">{`${monthName(today)} · дні навчання`}</div>
      <div className="cal">
        {WEEKDAYS.map((name) => (
          <div className="cal-h" key={name}>
            {name}
          </div>
        ))}
        {cells.map((cell) =>
          cell.day ? (
            <button
              className={cell.cls}
              key={cell.key}
              type="button"
              aria-pressed={cell.key === openDay}
              // Клітинка порожня, тож без цього кнопка не мала б жодного
              // доступного імені — тільки колір, якого не чути.
              aria-label={cell.key}
              onClick={() => setOpenDay(cell.key === openDay ? null : cell.key)}
            />
          ) : (
            <div className={cell.cls} key={cell.key} />
          ),
        )}
      </div>

      {openDay ? (
        <DayDetail
          day={openDay}
          facts={rows.get(openDay)}
          isToday={openDay === today}
        />
      ) : (
        <p className="explain">
          Золото — день, у який виконано обидві цілі. Бірюза — учився, але не
          добрав. Тапни день, щоб побачити, чого забракло.
        </p>
      )}
    </Screen>
  );
}
