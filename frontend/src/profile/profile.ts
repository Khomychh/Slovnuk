/**
 * Чиста логіка профілю: перевірки й перетворення без мережі й без React.
 *
 * Два з трьох правил тут — дзеркала бекенду, і саме тому вони не «зайва
 * перевірка на клієнті»: без них користувач отримує англійське повідомлення
 * pydantic посеред українського інтерфейсу («Ivan contains non-Ukrainian
 * letters»), причому вже після натискання «Зберегти».
 */

/** Межі денних цілей — `StudySettingsUpdateSchema`, `ge=0, le=1000`. */
export const GOAL_MAX = 1000;

/**
 * Рядок із поля цілі → число, яке прийме сервер.
 *
 * `null` означає «показати помилку і нічого не слати». Нуль — нормальне
 * значення, а не порожнеча: за моделлю це «ціль вимкнено».
 */
export function parseGoal(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d{1,4}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > GOAL_MAX ? null : parsed;
}

/**
 * Чому імʼя не підходить — або `null`, якщо підходить.
 *
 * Дзеркало `validate_name` у `backend/app/validation/profile.py`: там стоїть
 * `^[А-Яа-яЁёІіЇїЄєҐґ]*$`, тобто ані латиниці, ані пробілу, ані дефіса, ані
 * апострофа. Порожній рядок дозволений — це «стерти поле».
 */
export function nameProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[А-Яа-яЁёІіЇїЄєҐґ]*$/.test(trimmed)) {
    return "Лише українські літери — без латиниці, пробілів і дефісів.";
  }
  return null;
}

/**
 * Чи є що зберігати.
 *
 * Порівнюємо вже обрізані значення: пробіл у кінці поля не робить форму
 * зміненою, бо сервер його все одно не побачить.
 */
export function nameChanged(
  before: { firstName: string | null; lastName: string | null },
  after: { firstName: string; lastName: string },
): boolean {
  return (
    after.firstName.trim() !== (before.firstName ?? "") ||
    after.lastName.trim() !== (before.lastName ?? "")
  );
}

/**
 * Заголовок екрана профілю — імʼя й прізвище одним рядком.
 *
 * Порожні частини відкидаються, а не дають подвійний пробіл: прізвище на
 * бекенді необовʼязкове. Коли не заповнено нічого, лишається слово «Профіль» —
 * порожня шапка виглядала б як недовантажений екран.
 */
export function fullName(
  user: { first_name?: string | null; last_name?: string | null } | null,
): string {
  const parts = [user?.first_name, user?.last_name]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "");
  return parts.length > 0 ? parts.join(" ") : "Профіль";
}

/**
 * Адреса аватара з міткою версії.
 *
 * Ключ у сховищі детермінований (`avatars/{user_id}_avatar.jpg`), а посилання
 * на публічний бакет — статичне. Тобто після заміни аватара адреса та сама, і
 * браузер показує з кешу стару картинку — заміна виглядає як поломка. Мітка
 * версії ставиться в момент завантаження і живе в localStorage, тож правильна
 * картинка лишається правильною і після перезапуску застосунку.
 */
export function avatarSrc(
  url: string | null | undefined,
  version: string | null,
): string | null {
  if (!url) return null;
  if (!version) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}
