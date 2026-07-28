/**
 * Підпис інтервалу: скільки секунд — і як це сказати людині.
 *
 * Бекенд віддає прогноз у секундах навмисно (`RatingPreviewSchema`): перша
 * відповідь на нове слово повертає його через 1 і 10 хвилин, і в днях три числа
 * з чотирьох були б нулями. Формат залежить від мови, тому складається тут.
 *
 * Старий PWA підписував цим кнопки оцінок і скорочував до «1 дн» / «2.5 міс».
 * Тепер підпис зʼявляється ОДИН, уже після відповіді (ADR-0009), місця вистачає,
 * і слова пишуться повністю.
 */

/** Українське число: 1 хвилина, 2 хвилини, 5 хвилин. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * «за 10 хвилин», «за 12 днів», «за 3 місяці».
 *
 * Межі підібрані так, щоб не показувати «за 90 хвилин» замість «за 2 години» і
 * «за 400 днів» замість «за рік»: точність тут нікому не потрібна, потрібне
 * відчуття масштабу.
 */
export function humanInterval(seconds: number): string {
  if (seconds < 45) return "менш ніж за хвилину";

  if (seconds < 90 * MINUTE) {
    const minutes = Math.max(1, Math.round(seconds / MINUTE));
    return `за ${minutes} ${plural(minutes, "хвилину", "хвилини", "хвилин")}`;
  }

  // Межа годин низька навмисно. Інтервал в одну добу — найчастіший у FSRS, і
  // «за 24 години» замість «за 1 день» виглядало б як помилка. Години потрібні
  // лише для проміжку між кроками навчання і першою добою.
  if (seconds < 20 * HOUR) {
    const hours = Math.round(seconds / HOUR);
    return `за ${hours} ${plural(hours, "годину", "години", "годин")}`;
  }

  const days = Math.round(seconds / DAY);
  if (days < 45) {
    return `за ${days} ${plural(days, "день", "дні", "днів")}`;
  }

  if (days < 365) {
    const months = Math.round(days / 30);
    return `за ${months} ${plural(months, "місяць", "місяці", "місяців")}`;
  }

  const years = days / 365;
  // Один знак після коми, але без хвоста «1.0 року»: 1.5 року читається, 1.0 — ні.
  const rounded = Math.round(years * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `за ${rounded} ${plural(rounded, "рік", "роки", "років")}`;
  }
  return `за ${rounded.toFixed(1)} року`;
}

/** Той самий підпис, але цілим реченням — саме він зʼявляється після відповіді. */
export function nextShowLabel(seconds: number): string {
  return `наступного разу — ${humanInterval(seconds)}`;
}

/** Скільки секунд лишилось до моменту `dueAt` від `now`. Ніколи не відʼємне. */
export function secondsUntil(dueAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.round((new Date(dueAt).getTime() - now.getTime()) / 1000));
}
