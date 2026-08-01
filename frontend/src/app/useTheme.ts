/**
 * Звірка теми з сервером.
 *
 * Перше застосування робить інлайн-скрипт в `index.html`, підписку на системну
 * тему — `main.tsx`. Тут лишається рівно одне: тему могли змінити на іншому
 * пристрої, і коли налаштування приїжджають, локальний кеш вирівнюється по
 * них. Сервер лишається джерелом правди (ADR-0014); `localStorage` тримає
 * копію тільки заради першого кадру.
 */

import { useEffect } from "react";
import { readThemePreference, storeThemePreference } from "./theme";
import { useSettings } from "../study/queries";

export function useThemeSync(): void {
  const serverTheme = useSettings().data?.theme;

  useEffect(() => {
    if (!serverTheme || serverTheme === readThemePreference()) return;
    storeThemePreference(serverTheme);
  }, [serverTheme]);
}
