/**
 * Тема оформлення: преференція, резолвінг і застосування.
 *
 * ЧОМУ НЕ ЧЕРЕЗ ЗВИЧАЙНЕ ДЗЕРКАЛО НАЛАШТУВАНЬ. Решта преференцій живе в
 * IndexedDB (ADR-0014), і це правильно для всього, крім теми: IndexedDB
 * читається асинхронно, тобто відповідь приходить уже ПІСЛЯ першого кадру.
 * Людина зі світлою темою бачила б спалах полярної ночі при кожному холодному
 * старті — не помилку, але саме те, від чого застосунок здається зробленим
 * абияк. Тому тема, і тільки вона, дублюється ще й у `localStorage`, який
 * читається синхронно, і застосовується інлайн-скриптом в `index.html` до
 * першого малювання. Сервер лишається джерелом правди; `localStorage` тут не
 * друге джерело, а кеш заради першого кадру.
 *
 * ЧОМУ `system` НЕ ДОЇЖДЖАЄ ДО CSS. У `data-theme` пишеться завжди вже
 * розвʼязане `dark` або `light`. Інакше світлий блок токенів довелося б
 * тримати у двох копіях — під `[data-theme="light"]` і під
 * `prefers-color-scheme: light` всередині `[data-theme="system"]`, — і будь-яка
 * правка палітри мусила б потрапити в обидві.
 */

export type ThemePreference = "system" | "light" | "dark";
type Resolved = "light" | "dark";

/** Ключ читається ще й інлайн-скриптом в `index.html` — міняти разом. */
export const THEME_KEY = "slovnuk.theme";

/** Дорівнює `--night` кожної теми (`theme.css`). Розійтись їм не можна:
 *  смуга статусу телефона стоїть упритул, і різниця читається як шов. */
const BAR_COLOR: Record<Resolved, string> = {
  dark: "#070a14",
  light: "#eef1fa",
};

const isPreference = (value: unknown): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

function fromStorage(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    // Приватний режим може заборонити сховище. Тема — не та річ, заради якої
    // варто падати.
    return "system";
  }
}

/**
 * Поточна преференція — у модулі, а не в компоненті.
 *
 * Її читає обробник `matchMedia`, який живе довше за будь-який рендер. У
 * `useRef` вона застарівала б рівно тоді, коли тему щойно змінили з профілю:
 * системний перехід на світле вночі повернув би попередній вибір.
 */
let current: ThemePreference = fromStorage();

/** Що вибрав користувач. Незнайоме значення трактуємо як «системна». */
export function readThemePreference(): ThemePreference {
  return current;
}

function systemPrefersLight(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: light)").matches
  );
}

export function resolveTheme(preference: ThemePreference): Resolved {
  if (preference === "system") return systemPrefersLight() ? "light" : "dark";
  return preference;
}

/** Пише розвʼязану тему в документ. Єдине місце, що торкається DOM. */
export function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", BAR_COLOR[resolved]);
}

/** Запамʼятовує вибір і застосовує його. Сервер оновлюється окремо. */
export function storeThemePreference(preference: ThemePreference): void {
  current = preference;
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Не зберіглось — тема все одно застосується до кінця сеансу.
  }
  applyTheme(preference);
}

/**
 * Стежити за системною темою.
 *
 * Підписка живе завжди, а не лише при `system`: телефон перемикається на
 * світле вдень сам, і застосунок, відкритий із вечора, мусить піти за ним, не
 * чекаючи перезапуску. Коли преференція явна, `applyTheme` просто нічого не
 * змінює.
 */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia("(prefers-color-scheme: light)");
  const react = () => applyTheme(current);
  query.addEventListener("change", react);
  return () => query.removeEventListener("change", react);
}
