/**
 * Заглушки екранів, які ще не написані.
 *
 * Кожна названа так, як екран зватиметься насправді, і кожна каже, що саме тут
 * буде — порожній екран без пояснення виглядає як поломка.
 *
 * «Сьогодні» тут більше немає: він переїхав у `TodayScreen.tsx` разом із
 * блоком 2, «Словник» — у `VocabularyScreen.tsx` разом із блоком 3, а
 * «Профіль» — у `ProfileScreen.tsx`. Лишилась сама граматика.
 */

import { ProfileAvatar } from "../profile/ProfileAvatar";
import { Screen } from "../ui/parts";

export function GrammarScreen() {
  return (
    <Screen eyebrow="граматика" title="Довідник" aside={<ProfileAvatar />}>
      <div className="stub">
        Тут будуть розділи й нотатки. Блок 6.
      </div>
    </Screen>
  );
}

