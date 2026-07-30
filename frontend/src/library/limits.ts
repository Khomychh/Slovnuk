/**
 * Межі полів публікації — дзеркало серверних, а не друга істина.
 *
 * Повторюють `MAX_PUBLICATION_TITLE_LENGTH` і
 * `MAX_PUBLICATION_DESCRIPTION_LENGTH` із `backend/app/database/models/library.py`.
 * Змінюєте там — змініть і тут, інакше `maxLength` у полі дасть набрати те, що
 * сервер відкине 422-ю вже після натискання «Опублікувати».
 *
 * Живе окремим файлом, а не в `library.ts`: там чисті функції з текстами, і
 * тести на них не мусять тягти за собою числа, які нічого не обчислюють.
 */

export const MAX_TITLE = 100;
export const MAX_DESCRIPTION = 600;
