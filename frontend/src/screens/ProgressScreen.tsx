/**
 * «Прогрес» — наскільки міцно тримається словник.
 *
 * Герой екрана — теплова смуга: ширина кожної зупинки дорівнює кількості слів
 * у ній. Одразу після імпорту вона буде суцільно холодною, і це не порожній
 * екран, а точка відліку (ADR-0004: прогрес зі старого PWA не переносився).
 *
 * Два числа поруч виглядають як помилка, доки їх не підписати одиницею: смуга
 * рахує ДОРІЖКИ ПЕРЕКЛАДУ, по одній на картку, тож її сума дорівнює кількості
 * слів; «на повторення» рахує ДОРІЖКИ, а картка з формами дає їх дві.
 *
 * Агрегати за періоди рахує клієнт із тієї самої вибірки `GET /study/days/`.
 * Ендпоінта `/days/summary/` немає навмисно: межі «тижня з понеділка» в поясі
 * користувача інакше жили б у двох реалізаціях і тихо розійшлися б.
 *
 * Плитки рахують ЗАКРИТІ ДНІ, а не обсяг роботи. Правило й усі його пастки —
 * у `closedDays` (`study/day.ts`), під тестами: рахувати їх «на око» прямо тут
 * означало б, зокрема, що пропущений тиждень покращував би цифру.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { Screen } from "../ui/parts";
import { useVocabularyStats } from "../vocabulary/queries";
import { fetchDays } from "../api/study";
import {
  closedDays,
  localDay,
  resolveTimeZone,
  startOfWeek,
  type DayKey,
} from "../study/day";
import { useSettings } from "../study/queries";
import { plural } from "../ui/plural";

const BANDS = [
  { key: "new", name: "нове", token: "--a0" },
  { key: "under_day", name: "до 1 дня", token: "--a1" },
  { key: "days", name: "1–6 днів", token: "--a2" },
  { key: "weeks", name: "6–30 днів", token: "--a3" },
  { key: "months", name: "30–180 днів", token: "--a4" },
  { key: "long", name: "понад 180", token: "--a5" },
] as const;

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

/** Перший день місяця, у якому лежить `day`. Ключі — рядки «РРРР-ММ-ДД». */
function monthStart(day: DayKey): DayKey {
  return `${day.slice(0, 7)}-01`;
}

/** Скільки діб у місяці ключа. Рахується через UTC — ключ уже без часу. */
function daysInMonth(day: DayKey): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  // Нульовий день наступного місяця — останній день поточного.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * «липень». Рік не пишеться навмисно: сітка завжди показує поточний місяць, а
 * `year: "numeric"` в українській локалі дає «2026 р.», і в капсі це «2026 Р.».
 */
function monthName(day: DayKey): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    month: "long",
  }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * Плитка періоду: скільки днів закрито з тих, що були.
 *
 * Раніше тут стояв обсяг — повторені доріжки й додані слова. Обсяг за рік
 * росте сам від того, що ти не кидаєш, і однаково великий у того, хто вчиться
 * щодня, і в того, хто раз на місяць добиває все за раз. Закриті дні кажуть
 * саме те, чого від них хочуть: чи тримається звичка.
 *
 * Знаменник обовʼязковий. «64» за рік і «64» за місяць — це дві протилежні
 * новини, а без другого числа вони виглядають однаково.
 */
function Tile({ label, met, total }: { label: string; met: number; total: number }) {
  return (
    <div className="tile">
      <div className="tile-lbl">{label}</div>
      <div className="tile-num">{met}</div>
      <div className="tile-sub">
        {total > 0
          ? `з ${total} ${plural(total, "дня", "днів", "днів")}`
          : "днів ще не було"}
      </div>
    </div>
  );
}

export default function ProgressScreen() {
  const settings = useSettings();
  const timeZone = resolveTimeZone(settings.data?.timezone);
  const today = localDay(new Date(), timeZone);

  const stats = useVocabularyStats();

  // Без from/to — уся історія. Вона починається з дня імпорту і за рік
  // залишиться сотнями рядків, а не тисячами: рядок за добу, не за відповідь.
  const days = useQuery({
    queryKey: ["study", "days", "all"],
    queryFn: () => fetchDays(),
    staleTime: 60_000,
  });

  const items = days.data?.items ?? [];

  const totals = useMemo(() => {
    const year = `${today.slice(0, 4)}-01-01`;
    return {
      all: closedDays(items, null, today),
      year: closedDays(items, year, today),
      month: closedDays(items, monthStart(today), today),
      week: closedDays(items, startOfWeek(today), today),
    };
  }, [items, today]);

  // Сітка місяця з понеділка. Порожні клітинки на початку — не «нульові дні»,
  // а чужий місяць, тому вони прозорі, а не сірі.
  const cells = useMemo(() => {
    const rows = new Map(items.map((row) => [row.day, row]));
    const first = monthStart(today);
    const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
    const total = daysInMonth(today);

    const out: { key: string; cls: string }[] = [];
    for (let i = 0; i < lead; i += 1) out.push({ key: `out-${i}`, cls: "cal-c out" });
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
        cls: ["cal-c", state, key === today ? "now" : ""].filter(Boolean).join(" "),
      });
    }
    return out;
  }, [items, today]);

  const bands = stats.data?.stability_bands;

  return (
    <Screen title="Прогрес" aside={<ProfileAvatar />}>
      <div className="band" aria-label="Слова за температурою">
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
            <span className="leg-sw" style={{ background: `var(${band.token})` }} />
            <span className="leg-n">{band.name}</span>
            <span className="leg-v">{bands ? bands[band.key] : "—"}</span>
          </div>
        ))}
      </div>
      <div className="tiles">
        <Tile label="тиждень" {...totals.week} />
        <Tile label="місяць" {...totals.month} />
        <Tile label="рік" {...totals.year} />
        <Tile label="весь час" {...totals.all} />
      </div>

      <div className="card-label">{`${monthName(today)} · дні навчання`}</div>
      <div className="cal">
        {WEEKDAYS.map((name) => (
          <div className="cal-h" key={name}>
            {name}
          </div>
        ))}
        {cells.map((cell) => (
          <div className={cell.cls} key={cell.key} />
        ))}
      </div>

      <p className="explain">
        Золото — день, у який виконано обидві цілі. Бірюза — учився, але не
        добрав. Плитки вище рахують саме золоті дні; знаменник іде від першого
        дня історії, бо до нього днів навчання не існувало.
      </p>
    </Screen>
  );
}
