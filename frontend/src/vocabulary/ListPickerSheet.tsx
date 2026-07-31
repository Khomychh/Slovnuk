/**
 * Аркуш вибору списків для картки.
 *
 * На відміну від `ListFilterSheet` (обирає ОДИН список для перегляду), тут
 * вибір множинний і не закриває аркуш сам по собі: людина вмикає кілька
 * списків підряд, і аркуш чекає, поки не натиснуть «Готово». Рядки — той
 * самий `.sheet-row`, що у фільтрі: довгі назви списків тут так само не
 * влазять у чіп без обрізання чи перенесення.
 */

import { useEffect } from "react";

export type ListPickerItem = { id: number; name: string; card_count: number };

export default function ListPickerSheet({
  items,
  selected,
  defaultListId,
  onToggle,
  onClose,
}: {
  items: ListPickerItem[];
  selected: number[];
  defaultListId: number | null;
  onToggle: (id: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Списки картки"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-title">Списки</div>

        {items.map((item) => {
          const on = selected.includes(item.id);
          return (
            <button
              key={item.id}
              className={on ? "sheet-row sheet-row-on" : "sheet-row"}
              type="button"
              onClick={() => onToggle(item.id)}
              aria-pressed={on}
            >
              <span>
                {item.name}
                {item.id === defaultListId ? (
                  <span className="sheet-star" title="Список за замовчуванням">
                    {" "}
                    ★
                  </span>
                ) : null}
              </span>
              <span className="sheet-check" aria-hidden="true">
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}

        <div className="confirm-acts">
          <button className="btn" type="button" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
