/**
 * Аркуш вибору розділу.
 *
 * Форма дзеркалить `ListFilterSheet` словника, але зміст інший: розділ — не
 * мітка. Нотатка лежить щонайбільше в одному розділі, тож вибір тут завжди
 * рівно один, а не набір.
 *
 * Порожні розділи показуються з лічильником `0`: розділ, з якого пішла остання
 * нотатка, живе далі (CONTEXT.md), і сховати його означало б зробити його
 * невидимим саме тоді, коли його треба видалити.
 */

import { useNavigate } from "react-router-dom";
import { useCategories } from "./queries";

export type CategoryPick = { categoryId: number | null; uncategorized: boolean };

export const ALL_CATEGORIES: CategoryPick = {
  categoryId: null,
  uncategorized: false,
};

export default function CategoryFilterSheet({
  pick,
  onPick,
  onClose,
}: {
  pick: CategoryPick;
  onPick: (next: CategoryPick) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const categories = useCategories();

  const allActive = pick.categoryId === null && !pick.uncategorized;

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Вибір розділу"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className={allActive ? "sheet-row sheet-row-on" : "sheet-row"}
          type="button"
          onClick={() => onPick(ALL_CATEGORIES)}
        >
          <span>Усі нотатки</span>
        </button>

        {categories.data?.items.map((category) => (
          <button
            key={category.id}
            className={
              pick.categoryId === category.id ? "sheet-row sheet-row-on" : "sheet-row"
            }
            type="button"
            onClick={() =>
              onPick({ categoryId: category.id, uncategorized: false })
            }
          >
            <span>{category.name}</span>
            <span className="sheet-count">{category.note_count}</span>
          </button>
        ))}

        {/* Показується завжди, як і «Без списку» в словнику: нотатка потрапляє
            сюди сама, коли її розділ видалили, і сховати цю групу означало б
            загубити нотатку з очей. */}
        <button
          className={pick.uncategorized ? "sheet-row sheet-row-on" : "sheet-row"}
          type="button"
          onClick={() => onPick({ categoryId: null, uncategorized: true })}
        >
          <span className="sheet-muted">Без розділу</span>
          <span className="sheet-count">
            {categories.data?.uncategorized.note_count ?? 0}
          </span>
        </button>

        <button
          className="sheet-row sheet-manage"
          type="button"
          onClick={() => {
            onClose();
            navigate("/grammar/categories");
          }}
        >
          Керувати розділами
        </button>
      </div>
    </div>
  );
}
