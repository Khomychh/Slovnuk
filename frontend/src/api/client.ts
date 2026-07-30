/**
 * Клієнт API.
 *
 * Один origin: адреси починаються з /api/v1/ і йдуть на той самий домен. У
 * розробці їх проксює Vite, у продакшені — Caddy (ADR-0008). Тому тут немає
 * базового URL із змінної оточення: якби він був, розробка ходила б через CORS,
 * а продакшен ні, і перевірялась би не та конфігурація.
 */

import {
  clearTokens,
  getTokens,
  setAccessToken,
} from "../auth/tokens";

const BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  /** Машинний код із бекенду, коли він є: "account_not_activated" тощо. */
  readonly code: string | null;
  /**
   * Решта полів обʼєкта `detail`, коли бекенд поклав туди більше за код і текст.
   *
   * Потрібно там, де відповідь на помилку містить дані для дії: 409 `own_share`
   * і 409 `list_exists` віддають `list_id` того списку, на який треба
   * запропонувати перейти. Без цього екран міг би лише сказати «так не можна»,
   * не показавши, куди йти.
   */
  readonly details: Record<string, unknown> | null;

  constructor(
    status: number,
    message: string,
    code: string | null,
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Числове поле з `detail` — саме число або null, без «майже числа». */
  number(field: string): number | null {
    const value = this.details?.[field];
    return typeof value === "number" ? value : null;
  }
}

/** Немає мережі — це не помилка сервера, і поводитись із нею треба інакше. */
export class OfflineError extends Error {
  constructor() {
    super("Немає звʼязку");
    this.name = "OfflineError";
  }
}

type RequestOptions = {
  /**
   * PUT потрібен зірками Бібліотеки: одна людина — одна оцінка, тож повторний
   * виклик її замінює, а не додає другу. POST тут збрехав би про природу дії.
   */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** `FormData` їде як є — це аватар; усе інше серіалізується в JSON. */
  body?: unknown;
  /** Запит без токена: логін, активація, скидання пароля. */
  anonymous?: boolean;
  signal?: AbortSignal;
};

/**
 * Дістає з відповіді щось, що можна показати людині.
 *
 * FastAPI кладе в detail або рядок, або обʼєкт {code, message}, або — на 422 —
 * масив помилок валідації. Три різні форми в одному полі, тож розбирати їх
 * доводиться тут, а не в кожному екрані.
 */
async function describeError(response: Response): Promise<ApiError> {
  let detail: unknown = null;
  try {
    detail = (await response.json())?.detail ?? null;
  } catch {
    /* тіло не JSON — лишаємось із самим статусом */
  }

  if (typeof detail === "string") {
    return new ApiError(response.status, detail, null);
  }
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const object = detail as { code?: string; message?: string };
    return new ApiError(
      response.status,
      object.message ?? "Щось пішло не так",
      object.code ?? null,
      detail as Record<string, unknown>,
    );
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string };
    return new ApiError(response.status, first.msg ?? "Некоректні дані", null);
  }
  return new ApiError(response.status, `Помилка ${response.status}`, null);
}

/**
 * Оновлення access-токена.
 *
 * Спільна на всі одночасні запити: якщо три запити впали з 401 разом, оновлення
 * має бути одне. Інакше другий і третій підуть зі старим refresh уже після того,
 * як перший його використав.
 */
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const tokens = getTokens();
  if (!tokens) return null;

  refreshing ??= (async () => {
    try {
      const response = await fetch(`${BASE}/accounts/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: tokens.refresh }),
      });
      if (!response.ok) {
        // Refresh мертвий (минуло 7 днів або його відкликали) — сесія скінчилась.
        clearTokens();
        return null;
      }
      const data = (await response.json()) as { access_token: string };
      setAccessToken(data.access_token);
      return data.access_token;
    } catch {
      // Мережі немає. Токени не чіпаємо: сесія жива, просто зараз не дістати.
      return null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, anonymous = false, signal } = options;

  const multipart = body instanceof FormData;
  const payload: BodyInit | undefined =
    body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body);

  const send = async (accessToken: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    // Для multipart заголовок не ставимо навмисно: його мусить проставити сам
    // fetch, бо тільки він знає межу (boundary) між частинами тіла.
    if (body !== undefined && !multipart) {
      headers["Content-Type"] = "application/json";
    }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    try {
      return await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: payload,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new OfflineError();
    }
  };

  let response = await send(anonymous ? null : (getTokens()?.access ?? null));

  // 401 на захищеній адресі — пробуємо оновити токен рівно один раз. Другий 401
  // після оновлення означає, що справа не в протермінованому access.
  if (response.status === 401 && !anonymous && getTokens()) {
    const fresh = await refreshAccessToken();
    if (fresh) response = await send(fresh);
  }

  if (!response.ok) throw await describeError(response);

  // 204 та порожні тіла: JSON там немає, і парсити його не треба.
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
