/**
 * Аркуш вибору ОДНОГО значення зі списку.
 *
 * Чому не рідний `<select>`, з якого це зроблено. На Android система малює
 * його повноекранним діалогом: одинадцять частин мови розкидані по всьому
 * екрану, а картка, заради якої це відкрили, зникає. Стилями воно не
 * лікується — вигляд belongs системі, не сторінці. Заразом рідний селект
 * змушував міряти поле за найдовшим пунктом списку («прикметник»), через що
 * рядок «частина мови / транскрипція» ділився не навпіл.
 *
 * Плата, і вона справжня: клавіатурну поведінку рідного селекта (пошук
 * набором, стрілки, Home/End) доводиться дописувати руками. Тут є Escape,
 * стрілки й Enter; пошуку набором немає — списки коротші за дюжину.
 *
 * Вибір закриває аркуш одразу. Це не `ListPickerSheet`, де вмикають кілька
 * списків підряд і тому потрібне «Готово»: тут друга відповідь скасовує
 * першу, і чекати нема на що.
 */

import { useEffect, useRef } from "react";

export type PickerOption<T extends string> = {
  value: T;
  label: string;
  /** Дрібним праворуч: те, що уточнює, але не називає. */
  note?: string;
};

export default function PickerSheet<T extends string>({
  title,
  value,
  options,
  onPick,
  onClose,
}: {
  title: string;
  value: T | null;
  options: PickerOption<T>[];
  onPick: (value: T) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Фокус їде на вибране, а не на перший рядок: аркуш відкривають, щоб
    // ЗМІНИТИ вибір, і починати щоразу згори означало б гортати до свого.
    const rows = box.current?.querySelectorAll<HTMLButtonElement>(".sheet-row");
    const current = box.current?.querySelector<HTMLButtonElement>(".sheet-row-on");
    (current ?? rows?.[0])?.focus();
  }, []);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...(box.current?.querySelectorAll<HTMLButtonElement>(".sheet-row") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    // По колу: інакше на краях списку клавіша просто перестає працювати, і це
    // читається як зависання, а не як межа.
    rows[(at + step + rows.length) % rows.length]?.focus();
  };

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={box}
        onKeyDown={onKey}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-title">{title}</div>

        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              className={on ? "sheet-row sheet-row-on" : "sheet-row"}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onPick(option.value);
                onClose();
              }}
            >
              <span>
                {option.label}
                {option.note ? <span className="sheet-note"> {option.note}</span> : null}
              </span>
              <span className="sheet-check" aria-hidden="true">
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
