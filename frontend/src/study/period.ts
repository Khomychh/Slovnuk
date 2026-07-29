/**
 * Підсумки за період — те, що показують плитки «Прогресу» і панель під ними.
 *
 * Усе рахується тут, у браузері, з тієї самої вибірки `GET /study/days/`, якою
 * малюється календар. Ендпоінта `/days/summary/` немає навмисно (ADR-0018):
 * межі «тижня з понеділка» в поясі користувача інакше жили б у двох
 * реалізаціях і тихо розійшлися б. Побічний виграш — панелі відкриваються
 * миттєво й працюють офлайн із кешу.
 *
 * Модуль стоїть окремо від `day.ts` не за розміром, а за природою: там
 * арифметика дат, яка нічого не знає про навчання, тут правила читання рядків
 * дня, які нічого не знають про пояси.
 *
 * ## Два різні поняття межі, і їх не можна плутати
 *
 * **Агрегати спиняються на сьогодні.** Закрити майбутній день неможливо, тож
 * `closedDays`, `periodVolume` і `longestStreak` рахують по `today` включно і
 * далі не дивляться.
 *
 * **Смужка охоплює весь період.** `volumeBars` малює й майбутню частину тижня
 * порожніми стовпчиками: у тижня сім днів незалежно від того, яка сьогодні
 * середа, і смужка з чотирьох стовпчиків у середу читалась би як «тиждень
 * скінчився».
 *
 * ## Дні без активності у відповідь не приходять
 *
 * Сервер віддає лише ті дні, де щось було. Тому жодна функція тут не має права
 * рахувати щось «за довжиною rows» — тільки перебором календаря або перебором
 * знайдених рядків. Найдовша серія особливо чутлива: пропущений день у `rows`
 * просто відсутній, і серія мусить обриватись саме на його місці.
 */

import { addDays, addMonths, type DayKey } from "./day";

/**
 * Рядок дня в тому обсязі, який потрібен підсумкам.
 *
 * Структурний тип, а не `StudyDay` зі схеми: так функції тестуються трьома
 * полями замість шести, а зміна необовʼязкового поля в OpenAPI не тягне за
 * собою правку тестів.
 */
export type DayRow = {
  day: DayKey;
  new_count: number;
  review_count: number;
  is_goal_met: boolean;
};

/** Найраніший день історії, або null, якщо історії ще немає. */
export function firstDay(rows: { day: DayKey }[]): DayKey | null {
  // Перебором, а не як `rows[0]`: порядок відповіді — питання контракту
  // сервера, а не цієї функції.
  let first: DayKey | null = null;
  for (const row of rows) {
    if (first === null || row.day < first) first = row.day;
  }
  return first;
}

/** Рядки періоду [from … today], старіші першими. `from = null` — уся історія. */
function rowsInPeriod(
  rows: DayRow[],
  from: DayKey | null,
  today: DayKey,
): DayRow[] {
  return rows
    .filter((row) => row.day <= today && (from === null || row.day >= from))
    .sort((left, right) => (left.day < right.day ? -1 : 1));
}

/**
 * Скільки днів періоду закрито — велике число на плитці.
 *
 * Знаменника більше немає: плитка показує одне число, а одиниця сказана
 * рубрикою над рядом плиток (ADR-0018). Тому тут не потрібен ані перший день
 * історії, ані довжина періоду — тільки лічильник золотих днів.
 *
 * Сьогодні зараховується, якщо ціль уже добита: `is_goal_met` сервер
 * дораховує на льоту, тож цифра росте в ту мить, коли ти закриваєш добу.
 */
export function closedDays(
  rows: { day: DayKey; is_goal_met: boolean }[],
  from: DayKey | null,
  today: DayKey,
): number {
  let met = 0;
  for (const row of rows) {
    if (
      row.day <= today &&
      (from === null || row.day >= from) &&
      row.is_goal_met
    ) {
      met += 1;
    }
  }
  return met;
}

/** Обсяг роботи за період. */
export type PeriodVolume = {
  /** Різні доріжки, показані за період. У сумі за дні, а не за відповіді. */
  reviews: number;
  /** Скільки карток створено. */
  newCards: number;
  /** Днів, у які було хоч щось — включно з незакритими. */
  activeDays: number;
  /** Скільки повторень на день у середньому, по активних днях. Нуль — якщо їх немає. */
  perActiveDay: number;
};

/**
 * Обсяг за період — рядки «Повторено», «Додано», «Середнє».
 *
 * Середнє ділиться на АКТИВНІ дні, а не на довжину періоду. Інакше «весь час»
 * показував би тим менше, чим довше ти користуєшся застосунком: знаменник росте
 * щодня, зокрема й тими днями, коли тебе не було. Питання, на яке відповідає
 * цей рядок, — «скільки я роблю, коли сідаю вчитись», а не «скільки я роблю в
 * середньому по календарю».
 *
 * `review_count` — це різні доріжки за добу, а не відповіді (так рахує
 * `count_reviewed_tracks_by_day`). Доріжка, показана за день тричі через кроки
 * навчання, дає одиницю. Правило те саме, що в цілі повторень, тож числа між
 * екранами сходяться.
 */
export function periodVolume(
  rows: DayRow[],
  from: DayKey | null,
  today: DayKey,
): PeriodVolume {
  let reviews = 0;
  let newCards = 0;
  let activeDays = 0;

  for (const row of rowsInPeriod(rows, from, today)) {
    reviews += row.review_count;
    newCards += row.new_count;
    // Рядок дня створюється при першій же дії доби (`ensure_study_day`), тож
    // сам факт рядка ще не означає активності: день міг відкритись цілями і
    // лишитись порожнім. Активним його робить робота, а не існування рядка.
    if (row.review_count > 0 || row.new_count > 0) activeDays += 1;
  }

  return {
    reviews,
    newCards,
    activeDays,
    perActiveDay: activeDays > 0 ? Math.round(reviews / activeDays) : 0,
  };
}

/**
 * Найдовша низка закритих днів підряд у межах періоду.
 *
 * Обриває серію все, що не є закритим днем: і день, у який ти вчився, але не
 * добрав, і день, у який не заходив зовсім. Другий випадок і є пасткою — такого
 * дня в `rows` просто немає, тож послідовність треба перевіряти датами, а не
 * сусідством у масиві. Інакше пропущений тиждень склеював би дві серії в одну
 * довгу, тобто прогул ПОКРАЩУВАВ би цифру.
 *
 * Серію, що перетинає межу періоду, обрізає межа: у «місяці» видно тільки її
 * частину з цього місяця. Це свідомо — панель відповідає про період, а не про
 * все життя (CONTEXT.md, «Серія»).
 */
export function longestStreak(
  rows: { day: DayKey; is_goal_met: boolean }[],
  from: DayKey | null,
  today: DayKey,
): number {
  const met = rows
    .filter((row) => row.is_goal_met && row.day <= today)
    .filter((row) => from === null || row.day >= from)
    .map((row) => row.day)
    .sort();

  let best = 0;
  let run = 0;
  let previous: DayKey | null = null;

  for (const day of met) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }
  return best;
}

/** Один стовпчик смужки. */
export type VolumeBar = {
  key: string;
  /** Повторення за цю добу (або за цей місяць). */
  value: number;
  /** Підпис під стовпчиком, або null — підписані не всі. */
  tick: string | null;
  /** Чи цей стовпчик — поточна доба (місяць). Позначається, а не фарбується. */
  now: boolean;
};

const WEEKDAY_TICKS = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

/**
 * «лип» — три літери без точки.
 *
 * `month: "short"` в українській локалі дає «лип.», і точка під стовпчиком
 * читається як крапка на осі. Рік не пишеться: смужка завжди в межах одного
 * періоду, і його межі підписані заголовком панелі.
 */
function monthTick(key: DayKey): string {
  const name = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    month: "short",
  }).format(new Date(`${key.slice(0, 7)}-01T00:00:00Z`));
  return name.replace(".", "");
}

/**
 * Стовпчики смужки за період.
 *
 * `unit` вибирає екран, а не ця функція: тиждень і місяць ідуть по днях, рік і
 * «загалом» — по місяцях. Причина арифметична — рік по днях це 365 стовпчиків
 * шириною в піксель, тобто вже не графік, а текстура.
 *
 * Порожні відрізки в результаті Є, з нульовим значенням: смужка малює календар
 * періоду, а не список того, що знайшлось. День, у який ти не вчився, мусить
 * бути видимою прогалиною, інакше смужка з трьох стовпчиків за місяць
 * виглядала б як бездоганні три дні поспіль.
 */
export function volumeBars(
  rows: DayRow[],
  from: DayKey,
  to: DayKey,
  unit: "day" | "month",
  today: DayKey,
): VolumeBar[] {
  const step = unit === "day" ? addDays : addMonths;
  // Ключ місячного відрізка — його перше число, тож рядок дня падає у відрізок
  // за префіксом «РРРР-ММ». Для добового відрізка префікс — це весь ключ.
  const width = unit === "day" ? 10 : 7;
  const bucketOf = (day: DayKey) => day.slice(0, width);

  const sums = new Map<string, number>();
  for (const row of rows) {
    const bucket = bucketOf(row.day);
    sums.set(bucket, (sums.get(bucket) ?? 0) + row.review_count);
  }

  const keys: DayKey[] = [];
  for (let key = from; key <= to; key = step(key, 1)) keys.push(key);

  // Підписи ставляться не на всі стовпчики: 31 підпис під 31 стовпчиком
  // злипається в сіру смугу. Сім і дванадцять читаються повністю, довше —
  // кожен сьомий, тобто той самий день тижня.
  const dense = keys.length > 12;

  return keys.map((key, index) => {
    let tick: string | null = null;
    if (unit === "month") {
      tick = monthTick(key);
    } else if (keys.length <= 7) {
      tick = WEEKDAY_TICKS[index % 7] ?? null;
    } else if (!dense || index % 7 === 0) {
      tick = String(Number(key.slice(8, 10)));
    }

    return {
      key,
      value: sums.get(bucketOf(key)) ?? 0,
      tick,
      now: bucketOf(key) === bucketOf(today),
    };
  });
}
