/**
 * Українське відмінювання після числа.
 *
 * Живе окремо, бо потрібне щонайменше в трьох місцях, а зроблене на око —
 * помітне: «2 слів» у рядку списку одразу видно як недбалість.
 */
export function plural(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «14 слів», «2 слова», «1 слово». */
export function words(count: number): string {
  return `${count} ${plural(count, "слово", "слова", "слів")}`;
}

/** «8 списків», «2 списки», «1 список». */
export function lists(count: number): string {
  return `${count} ${plural(count, "список", "списки", "списків")}`;
}

/** «9 нотаток», «2 нотатки», «1 нотатка». */
export function notes(count: number): string {
  return `${count} ${plural(count, "нотатка", "нотатки", "нотаток")}`;
}
