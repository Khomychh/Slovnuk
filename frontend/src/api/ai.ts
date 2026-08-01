/**
 * Виклики ШІ.
 *
 * Роут один, і він не торкається словника (ADR-0027): приймає слово, повертає
 * значення, форми і зрідка коментар. У базі після нього не змінюється нічого —
 * пропозиція потрапляє туди звичайним збереженням картки, якщо людина погодиться.
 *
 * Типи не пишуться руками — вони з `schema.d.ts`, згенерованого з OpenAPI.
 */

import { apiFetch } from "./client";
import type { components } from "./schema";

export type AiProposal = components["schemas"]["AiProposalSchema"];

/**
 * Пропозиція для одного слова.
 *
 * Відмови приходять помилками, а не порожньою пропозицією, і кожна значить
 * своє (`ApiError.code`):
 *
 * - 403 `ai_access_denied` — привілею немає (ADR-0026). Кнопки при цьому теж
 *   не буде: екран питає `ai_enabled` наперед;
 * - 409 `ai_word_already_filled` — це слово вже заповнювали. Одне успішне
 *   звернення на слово, назавжди (ADR-0028);
 * - 422 `ai_not_a_word` — не англійське слово. `message` несе причину від
 *   моделі, `details.did_you_mean` — на що це схоже. Виправляє людина: саме
 *   слово ШІ не міняє ніколи;
 * - 502 — Claude не відповів. Слово не спалене, можна ще раз;
 * - 503 `ai_not_configured` — ключа на сервері немає.
 */
export function proposeCard(word: string): Promise<AiProposal> {
  return apiFetch<AiProposal>("/ai/proposals/", {
    method: "POST",
    body: { word },
  });
}
