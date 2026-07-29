/**
 * Аватар у правому куті шапки — і водночас єдиний вхід у профіль.
 *
 * Профіль не є вкладкою (місце внизу зайняв «Прогрес»), тож потрапити в нього
 * можна тільки звідси. Саме тому він стоїть на всіх чотирьох вкладках, а не
 * лише на «Сьогодні»: інакше зі «Словника» чи «Граматики» довелось би спершу
 * вертатись на головну.
 *
 * У шапках входу, активації й скидання пароля його немає навмисно — там ще
 * немає кого показувати. Тому це окремий компонент, а не типове значення
 * `aside` в `Screen`.
 */

import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { avatarVersion } from "./avatar";
import { AvatarImage } from "./AvatarImage";
import { avatarSrc } from "./profile";

export function ProfileAvatar() {
  const { user } = useAuth();

  // Мітка версії потрібна, бо адреса файлу після заміни та сама — див.
  // `avatarSrc`.
  const src = avatarSrc(user?.avatar, avatarVersion());
  const initial = (user?.first_name || user?.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <Link className="avatar" to="/profile" aria-label="Профіль">
      <AvatarImage src={src} initial={initial} />
    </Link>
  );
}
