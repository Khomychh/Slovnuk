/**
 * Шер, за яким людина прийшла, але ще не мала акаунта.
 *
 * Задача: посилання мусить пережити вхід — а для нового користувача ще й
 * реєстрацію з листом активації. Прокинути це через `?next=` не вдається: адресу
 * листа будує бекенд із `FRONTEND_BASE_URL`, і жодного `next` він не знає. Тому
 * анонімний візит на `/shares/:token` сам записує токен тут, а перший успішний
 * вхід його забирає.
 *
 * Живе поруч із токенами сесії (localStorage, ADR-0008), тож нового класу стану
 * не з'являється. ADR немає навмисно: відкотити це — десяток рядків, той самий
 * критерій, за яким його не писали для часового поясу.
 */

const KEY = "slovnuk.pending_share";

/**
 * Скільки живе запис.
 *
 * Без межі забутий токен спрацював би через тиждень на будь-якому вході й
 * закинув би людину на екран імпорту списку, про який вона вже й не думала.
 * Добу видано з запасом на «відкрив посилання ввечері, активував акаунт зранку».
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Pending = { token: string; at: number };

function read(): Pending | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pending>;
    if (typeof parsed?.token !== "string" || typeof parsed?.at !== "number") {
      return null;
    }
    if (Date.now() - parsed.at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { token: parsed.token, at: parsed.at };
  } catch {
    // Сховище може бути недоступним (приватний режим) або вміст — сміттям.
    // Ні те, ні інше не варте того, щоб ламати вхід.
    return null;
  }
}

export function rememberShare(token: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {
    /* нема куди записати — просто не буде повернення за посиланням */
  }
}

/**
 * Чи є куди вести після входу. Не забирає нічого.
 *
 * Читання й забирання розділені навмисно. Після входу перекидань два: маршрут
 * `/accounts/login` в `App.tsx` бачить, що користувач уже залогінений, і сам
 * робить `Navigate`, — а `LoginScreen` робить свій. Якби кожне з них забирало
 * токен, перше з'їдало б його, а друге їхало «нікуди»: саме так і сталось,
 * перевірено живим браузером — після входу відкривалось «Сьогодні» замість
 * списку. Тому обидва лише читають, і ведуть в те саме місце.
 */
export function peekShare(): string | null {
  return read()?.token ?? null;
}

/** Куди вести після входу: шлях або нічого. */
export function pendingSharePath(): string | null {
  const token = peekShare();
  return token ? `/shares/${token}` : null;
}

export function forgetShare(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* див. вище */
  }
}
