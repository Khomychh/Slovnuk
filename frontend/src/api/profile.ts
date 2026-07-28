/**
 * Виклики профілю й облікового запису.
 *
 * Адреси профілю містять `user_id`, хоча чужий профіль однаково не відкрити:
 * `_authorize_profile_access` порівнює id з токеном. Свій id беремо з
 * `/accounts/me/`, тобто з `AuthProvider`.
 */

import { apiFetch } from "./client";
import type { components } from "./schema";

export type Profile = components["schemas"]["ProfileResponseSchema"];
export type ProfileUpdate = components["schemas"]["ProfileUpdateSchema"];
export type MessageResponse = components["schemas"]["MessageResponseSchema"];

export function patchProfile(
  userId: number,
  body: ProfileUpdate,
): Promise<Profile> {
  return apiFetch<Profile>(`/profiles/${userId}/`, { method: "PATCH", body });
}

/**
 * Аватар — multipart, а не JSON: інша адреса й інший тип тіла.
 *
 * Файл сюди приходить уже стиснутим (`prepareAvatar`), бо сервер приймає не
 * більше 1 МБ, а знімок із телефона важить кілька.
 */
export function uploadAvatar(userId: number, file: Blob): Promise<Profile> {
  const form = new FormData();
  form.append("avatar", file, "avatar.jpg");
  return apiFetch<Profile>(`/profiles/${userId}/avatar/`, {
    method: "PATCH",
    body: form,
  });
}

// Обгортки над `DELETE /profiles/{id}/avatar/` тут немає навмисно: екран фото
// лише замінює, і мертвий виклик без жодного місця виклику був би зайвим.
// Сам ендпоінт живий — див. HANDOFF.

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<MessageResponse> {
  return apiFetch<MessageResponse>("/accounts/change-password/", {
    method: "POST",
    body: { current_password: currentPassword, new_password: newPassword },
  });
}
