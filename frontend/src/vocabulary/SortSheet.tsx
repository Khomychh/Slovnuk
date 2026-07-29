/**
 * Аркуш вибору порядку словника.
 *
 * Кнопка-перемикач тут була, доки порядків було два: тап міняв стан, і підпис
 * казав, у якому ти зараз. На трьох це ламається — щоб дійти до третього,
 * треба тапнути двічі й прочитати проміжний, а який третій узагалі є, кнопка не
 * показує. Тому аркуш: усі три видно одночасно, як і списки поруч.
 *
 * Підписи називають РЕЗУЛЬТАТ, а не величину («нові зверху», а не «за датою»):
 * так вони склались у цьому екрані ще для двох порядків, і третій не має
 * говорити іншою мовою.
 */

import type { CardSort } from "../api/vocabulary";

/** Шість зупинок рампи — ті самі, що в теплових смугах і в `temperature.ts`. */
const RAMP = ["--a0", "--a1", "--a2", "--a3", "--a4", "--a5"];

const OPTIONS: { value: CardSort; label: string }[] = [
  { value: "created", label: "нові зверху" },
  { value: "word", label: "за абеткою" },
  { value: "stability", label: "спершу холодні" },
];

export default function SortSheet({
  sort,
  onPick,
  onClose,
}: {
  sort: CardSort;
  onPick: (next: CardSort) => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Порядок слів"
        onClick={(event) => event.stopPropagation()}
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            className={sort === option.value ? "sheet-row sheet-row-on" : "sheet-row"}
            type="button"
            onClick={() => onPick(option.value)}
          >
            <span>{option.label}</span>
            {/* Рампа стоїть лише на своєму рядку, і не як прикраса: цей
                порядок їде саме нею, зліва направо. Словами те саме — «від
                щойно доданих через ті, що ледь тримаються, до давно
                відомих» — не вміщається в рядок аркуша. */}
            {option.value === "stability" ? (
              <span className="sheet-ramp" aria-hidden="true">
                {RAMP.map((token) => (
                  <i key={token} style={{ background: `var(${token})` }} />
                ))}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
