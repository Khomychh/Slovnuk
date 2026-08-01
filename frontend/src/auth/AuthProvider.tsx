/**
 * Стан «хто зайшов».
 *
 * Джерело правди — localStorage (tokens.ts), а не React-стан: клієнт API читає
 * токени напряму, бо про компоненти нічого не знає. Тут лише підписка, щоб
 * інтерфейс дізнався про вхід і про вихід — зокрема про той вихід, який
 * стався сам, коли протух refresh.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "../api/client";
import {
  clearTokens,
  getTokens,
  setTokens,
  subscribeTokens,
} from "./tokens";

export type CurrentUser = {
  id: number;
  email: string;
  is_active: boolean;
  role: string;
  /**
   * Чи можна цій людині заповнювати картку з ШІ.
   *
   * Похідне поле: бекенд зводить у нього дві різні перевірки — привілей у
   * `ai_access` (ADR-0026) і наявність ключа на сервері. Фронтенду різниця
   * між «тобі не можна» і «тут цього немає» не потрібна: обидва означають, що
   * кнопки не буде.
   */
  ai_enabled: boolean;
  first_name: string | null;
  last_name: string | null;
  /** Готова адреса файлу в публічному бакеті, а не ключ. null — аватара немає. */
  avatar: string | null;
};

type LoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

type AuthValue = {
  /** null — ще не знаємо; далі або користувач, або false. */
  user: CurrentUser | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Перечитати `/accounts/me/` — після правки імені чи аватара. */
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthValue["status"]>(
    getTokens() ? "loading" : "anonymous",
  );

  const loadUser = useCallback(async () => {
    if (!getTokens()) {
      setUser(null);
      setStatus("anonymous");
      return;
    }
    try {
      setUser(await apiFetch<CurrentUser>("/accounts/me/"));
      setStatus("authenticated");
    } catch {
      // Сюди потрапляємо і коли токен мертвий, і коли просто немає мережі.
      // Різниця істотна: у другому випадку токени лишаються, і наступна спроба
      // (уже зі звʼязком) відновить сесію без повторного логіна.
      if (getTokens()) {
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus("anonymous");
      }
    }
  }, []);

  useEffect(() => {
    void loadUser();
    return subscribeTokens((tokens) => {
      if (!tokens) {
        setUser(null);
        setStatus("anonymous");
      }
    });
  }, [loadUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiFetch<LoginResponse>("/accounts/login/", {
        method: "POST",
        anonymous: true,
        body: { email, password },
      });
      setTokens({ access: data.access_token, refresh: data.refresh_token });
      await loadUser();
    },
    [loadUser],
  );

  const logout = useCallback(() => {
    clearTokens();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, status, login, logout, refreshUser: loadUser }),
    [user, status, login, logout, loadUser],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth використано поза AuthProvider");
  return value;
}
