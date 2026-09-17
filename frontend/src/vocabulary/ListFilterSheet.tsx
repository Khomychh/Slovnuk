/**
 * Аркуш вибору списку.
 *
 * Чіпси в рядок відкинуто свідомо: назви списків довгі («Неправильні
 * дієслова»), і в горизонтальному скролі разом із ними поїхали б лічильники —
 * а саме вони тут найкорисніші.
 *
 * «Без списку» стоїть окремим рядком під списками, бо це не список, а
 * відсутність міток (CONTEXT.md).
 *
 * Керування списками звідси прибрано (ADR-0021): аркуш робить одну справу —
 * вибирає фільтр. Другі двері в те саме місце тут були б глибші за перші, бо
 * «Списки» тепер лежать кнопкою в шапці цього ж екрана.
 */

import type { Browse } from "./queries";
import { useLists } from "./queries";
import { useSettings } from "../study/queries";

export type FilterPick = { listId: number | null; unlisted: boolean };

/** Вибране — галочкою, як в інших аркушах вибору. Слот є завжди, щоб числа стояли стовпчиком. */
function Check({ on }: { on: boolean }) {
  return (
    <span className="sheet-check" aria-hidden="true">
      {on ? "✓" : ""}
    </span>
  );
}

export default function ListFilterSheet({
  browse,
  onPick,
  onClose,
}: {
  browse: Browse;
  onPick: (next: FilterPick) => void;
  onClose: () => void;
}) {
  const lists = useLists();
  const settings = useSettings();

  const defaultListId = settings.data?.default_list_id ?? null;
  const allActive = browse.listId === null && !browse.unlisted;

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Вибір списку"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-title">Списки</div>

        <button
          className={allActive ? "sheet-row sheet-row-on" : "sheet-row"}
          type="button"
          onClick={() => onPick({ listId: null, unlisted: false })}
        >
          <span>Усі слова</span>
          <Check on={allActive} />
        </button>

        {lists.data?.items.map((item) => (
          <button
            key={item.id}
            className={
              browse.listId === item.id ? "sheet-row sheet-row-on" : "sheet-row"
            }
            type="button"
            onClick={() => onPick({ listId: item.id, unlisted: false })}
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
            <span className="sheet-end">
              <span className="sheet-count">{item.card_count}</span>
              <Check on={browse.listId === item.id} />
            </span>
          </button>
        ))}

        {/* Показується завжди, навіть коли порожній: інакше картки, що втратили
            останній список, зникали б із очей — а на повторення вони б і далі
            приходили. */}
        <button
          className={browse.unlisted ? "sheet-row sheet-row-on" : "sheet-row"}
          type="button"
          onClick={() => onPick({ listId: null, unlisted: true })}
        >
          <span className="sheet-muted">Без списку</span>
          <span className="sheet-end">
            <span className="sheet-count">
              {lists.data?.unlisted.card_count ?? 0}
            </span>
            <Check on={browse.unlisted} />
          </span>
        </button>

      </div>
    </div>
  );
}
