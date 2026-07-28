/**
 * Підготовка аватара до завантаження.
 *
 * Сервер приймає JPG/PNG **не більше 1 МБ** (`validate_image`), а знімок із
 * телефона важить 3–5 МБ. Без стиснення профіль ламався б рівно на тому, заради
 * чого його відкривають: вибрав фото з галереї — отримав «Image size exceeds
 * 1 MB» англійською.
 *
 * 512 пікселів більш ніж достатньо: найбільший аватар в інтерфейсі — 72 CSS-px,
 * тобто 216 фізичних на екрані з потрійною щільністю.
 *
 * Мітка версії живе тут же, бо вона про той самий файл: ключ у сховищі
 * детермінований, посилання статичне, і без мітки браузер показував би стару
 * картинку. Саме перетворення адреси — у `profile.ts`, під тестами.
 */

const MAX_SIDE = 512;
const QUALITY = 0.85;
const VERSION_KEY = "slovnuk.avatar.version";

export function avatarVersion(): string | null {
  try {
    return localStorage.getItem(VERSION_KEY);
  } catch {
    return null;
  }
}

export function markAvatarChanged(): void {
  try {
    localStorage.setItem(VERSION_KEY, String(Date.now()));
  } catch {
    // Приватний режим Safari забороняє запис. Гірше, ніж могло б бути, тут
    // рівно одне: до перезавантаження сторінки видно стару картинку.
  }
}

/**
 * Файл із галереї → квадратний JPEG, який точно пройде перевірку сервера.
 *
 * Обрізаємо по центру: аватар усе одно показується в колі, і лист із боків
 * виглядав би як помилка. HEIC із iPhone сюди не доїде — canvas його не
 * декодує; такий файл чесно відкидається повідомленням, а не мовчазним збоєм.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Не вдалось прочитати зображення. Підійде JPG або PNG.");
  });

  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(side, MAX_SIDE);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не дав обробити зображення.");

  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY),
  );
  if (!blob) throw new Error("Не вдалось підготувати зображення.");
  return blob;
}
