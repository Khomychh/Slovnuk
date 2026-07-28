/**
 * Заглушки екранів, які ще не написані.
 *
 * Кожна названа так, як екран зватиметься насправді, і кожна каже, що саме тут
 * буде — порожній екран без пояснення виглядає як поломка.
 *
 * «Сьогодні» тут більше немає: він переїхав у `TodayScreen.tsx` разом із
 * блоком 2, а «Словник» — у `VocabularyScreen.tsx` разом із блоком 3.
 */

import { useAuth } from "../auth/AuthProvider";
import { Screen } from "../ui/parts";

export function GrammarScreen() {
  return (
    <Screen eyebrow="граматика" title="Довідник">
      <div className="stub">
        Тут будуть розділи й нотатки. Блок 6.
      </div>
    </Screen>
  );
}

export function ProfileScreen() {
  const { user, logout } = useAuth();

  return (
    <Screen eyebrow="профіль" title={user?.email ?? "Профіль"}>
      <div className="stub">
        Тут будуть тема, озвучення, денні цілі, часовий пояс. Блок 4.
      </div>
      <button
        className="btn-quiet"
        type="button"
        onClick={logout}
        style={{ marginTop: 22 }}
      >
        Вийти
      </button>
    </Screen>
  );
}
