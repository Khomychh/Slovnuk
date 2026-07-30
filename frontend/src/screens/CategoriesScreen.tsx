/**
 * Керування розділами.
 *
 * Кнопки «створити» тут немає навмисно: розділ заводиться самою назвою в
 * редакторі нотатки, і другий шлях створення означав би порожні розділи, які
 * ніхто не просив. Лишається те, чого інакше не зробити ніяк — перейменувати й
 * видалити.
 *
 * Ручного порядку немає, як і в списках слів: розділи віддаються за `position`,
 * а на п'яти розділах перестановка вирішувала б проблему, якої ще немає.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { PencilIcon, Screen, TrashIcon } from "../ui/parts";
import ConfirmSheet from "../ui/ConfirmSheet";
import { notes as notesLabel, plural } from "../ui/plural";
import {
  useCategories,
  useDeleteCategory,
  useRenameCategory,
} from "../grammar/queries";

export default function CategoriesScreen() {
  const navigate = useNavigate();
  const online = useOnline();

  const categories = useCategories();
  const rename = useRenameCategory();
  const remove = useDeleteCategory();

  const [error, setError] = useState<string | null>(null);
  /** Який саме розділ питають видалити. Рядків багато — прапорця тут мало. */
  const [asking, setAsking] = useState<{
    id: number;
    name: string;
    noteCount: number;
  } | null>(null);

  const onRename = async (id: number, current: string) => {
    const next = window.prompt("Нова назва розділу", current);
    if (!next || next.trim() === current) return;
    setError(null);
    try {
      await rename.mutateAsync({ id, name: next.trim() });
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Не вдалось перейменувати",
      );
    }
  };

  const onDelete = async (id: number) => {
    setError(null);
    try {
      await remove.mutateAsync(id);
      setAsking(null);
    } catch (problem) {
      setAsking(null);
      setError(problem instanceof Error ? problem.message : "Не вдалось видалити");
    }
  };

  const items = categories.data?.items ?? [];
  // Нотатка лежить щонайбільше в одному розділі, тож сума лічильників плюс «без
  // розділу» дорівнює довіднику — на відміну від списків слів, де картка може
  // бути в кількох і сума не дорівнює нічому.
  const totalNotes =
    items.reduce((sum, category) => sum + category.note_count, 0) +
    (categories.data?.uncategorized.note_count ?? 0);

  return (
    <Screen
      title="Розділи"
      back={() => navigate(-1)}
      aside={
        items.length > 0 ? (
          <div className="head-count">{notesLabel(totalNotes)}</div>
        ) : undefined
      }
    >
      {error ? <div className="msg msg-error">{error}</div> : null}

      {items.length === 0 ? (
        <div className="stub">
          Розділів ще немає. Вони заводяться самі: впишіть назву в полі «Розділ»,
          коли створюєте нотатку.
        </div>
      ) : null}

      {items.map((category) => (
        <div className="list-row" key={category.id}>
          <div className="list-row-main">
            <div className="list-row-name">{category.name}</div>
            <div className="list-row-sub">{notesLabel(category.note_count)}</div>
          </div>
          {/* Іконки, як у списках слів: два підписи поруч не влазили, і
              «Перейменувати» доводилось скорочувати до «Перейм.». */}
          <button
            className="row-icon"
            type="button"
            disabled={!online}
            aria-label={`Перейменувати «${category.name}»`}
            title="Перейменувати"
            onClick={() => onRename(category.id, category.name)}
          >
            <PencilIcon />
          </button>
          <button
            className="row-icon row-icon-danger"
            type="button"
            disabled={!online}
            aria-label={`Видалити «${category.name}»`}
            title="Видалити"
            onClick={() =>
              setAsking({
                id: category.id,
                name: category.name,
                noteCount: category.note_count,
              })
            }
          >
            <TrashIcon />
          </button>
        </div>
      ))}

      {categories.data && categories.data.uncategorized.note_count > 0 ? (
        <div className="hint">
          Без розділу: {notesLabel(categories.data.uncategorized.note_count)}. Це не
          розділ — його не можна перейменувати чи видалити.
        </div>
      ) : null}

      {!online ? <div className="hint">Зміни потребують звʼязку.</div> : null}

      {asking ? (
        <ConfirmSheet
          title={`Видалити розділ «${asking.name}»?`}
          // Наслідок мусить казати правду: FK стоїть на SET NULL, тож нотатки
          // живі. У старому PWA групи як сутності не було взагалі, тож
          // очікування тут ні на чому не тримається — і саме тому це треба
          // назвати вголос.
          note={
            asking.noteCount === 0
              ? "Нотаток у ньому немає."
              : `${notesLabel(asking.noteCount)} ${plural(asking.noteCount, "залишиться", "залишаться", "залишаться")} в довіднику — ${plural(asking.noteCount, "вона перейде", "вони перейдуть", "вони перейдуть")} у «Без розділу».`
          }
          confirmLabel="Видалити розділ"
          busy={remove.isPending}
          onConfirm={() => void onDelete(asking.id)}
          onCancel={() => setAsking(null)}
        />
      ) : null}
    </Screen>
  );
}
