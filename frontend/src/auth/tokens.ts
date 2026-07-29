/**
 * Зберігання токенів.
 *
 * localStorage, а не httpOnly-cookie — свідомо, причина в ADR-0008. Коротко:
 * cookie не рятує від скрипта, що вже виконався на сторінці (він однаково
 * зробить запит до /api/ від твого імені), а коштує змін у бекенді й
 * CSRF-механіки. Захист вкладено в інше — чужий текст ніде не рендериться як
 * сирий HTML.
 *
 * Тут навмисно немає React: до токенів треба дотягуватись із клієнта API, який
 * про компоненти нічого не знає.
 */

const ACCESS_KEY = "slovnuk.access";
const REFRESH_KEY = "slovnuk.refresh";

export type Tokens = {
  access: string;
  refresh: string;
};

/** Підписники на вхід/вихід — щоб React дізнався, що сесія скінчилась. */
type Listener = (tokens: Tokens | null) => void;
const listeners = new Set<Listener>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Приватний режим у деяких браузерах кидає на доступі до сховища.
    // Застосунок має працювати до перезавантаження, а не падати на старті.
    return null;
  }
}

export function getTokens(): Tokens | null {
  const access = read(ACCESS_KEY);
  const refresh = read(REFRESH_KEY);
  return access && refresh ? { access, refresh } : null;
}

export function setTokens(tokens: Tokens): void {
  try {
    localStorage.setItem(ACCESS_KEY, tokens.access);
    localStorage.setItem(REFRESH_KEY, tokens.refresh);
  } catch {
    /* див. read() */
  }
  listeners.forEach((fn) => fn(tokens));
}

/** Оновлення віддає лише access — refresh лишається той самий (7 днів). */
export function setAccessToken(access: string): void {
  const current = getTokens();
  if (!current) return;
  try {
    localStorage.setItem(ACCESS_KEY, access);
  } catch {
    /* див. read() */
  }
  listeners.forEach((fn) => fn({ ...current, access }));
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* див. read() */
  }
  listeners.forEach((fn) => fn(null));
}

export function subscribeTokens(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
