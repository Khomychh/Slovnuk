/**
 * «Що вчити» — напрямок і групи слів, розгортається під кнопкою «Вчити».
 *
 * Раніше це був окремий екран (`/study/settings`, ADR-історія в коментарі
 * `StudySettingsScreen`, який цей файл замінив): дотик по шестерні відкидав із
 * «Сьогодні» на новий маршрут і назад. Тепер шестерня розгортає панель на тому
 * самому екрані — вибір і кнопка, яка на нього впливає, лишаються в одному
 * кадрі.
 *
 * Панель завжди змонтована, навіть згорнутою (`open={false}`): анімація
 * згортання через `grid-template-rows` (ui.css, `.aim-panel-shell`) працює,
 * лише поки вміст нікуди не дівається під час переходу. `inert` ховає її від
 * клавіатури й читалок екрана, коли вона згорнута, — не через умовний рендер,
 * який зірвав би саму анімацію.
 *
 * Запит нової черги — на ЗГОРТАННЯ панелі, а не на кожен дотик по рядку
 * (`aimSettled`, детально в `store.ts`): вибір переводять дотиками, і чотири
 * повні вибірки поспіль заради трьох переданих думок були б марними.
 */

import { useEffect, useMemo, useState } from "react";
import { useOnline } from "../app/useOnline";
import { useLists, useSettings, useStudy, useUpdateSettings } from "./queries";
import { aimIsAll } from "./session";
import { DIRECTIONS, aimRows, splitRows } from "./aim";
import { aimSettled, setAim } from "./store";

/** З якої кількості рядків зʼявляється пошук. Нижче — шукати довше, ніж глянути. */
const SEARCH_AT = 12;

export default function StudyAimPanel({ open }: { open: boolean }) {
  const online = useOnline();
  const study = useStudy();
  const lists = useLists();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  const [query, setQuery] = useState("");
  const [tailOpen, setTailOpen] = useState(false);

  // Новий вибір летить у чергу на ЗГОРТАННЯ, а не на розмонтування «Сьогодні»:
  // панель тепер живе поруч із героєм, а не на власному екрані, з якого
  // виходять назавжди. Ефект чіпляється лише поки панель розгорнута — тому
  // прибирання спрацьовує рівно раз, на перехід у `false`, а не на кожен рендер.
  useEffect(() => {
    if (!open) return;
    return () => void aimSettled();
  }, [open]);

  const aim = study.aim;
  const rows = useMemo(() => aimRows(aim, lists.data), [aim, lists.data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(needle));
  }, [rows, query]);

  const { hot, cold } = useMemo(() => splitRows(filtered), [filtered]);

  const pick = (id: number | null) => {
    if (id === null) {
      void setAim({ ...aim, unlisted: !aim.unlisted });
      return;
    }
    const has = aim.listIds.includes(id);
    void setAim({
      ...aim,
      listIds: has ? aim.listIds.filter((one) => one !== id) : [...aim.listIds, id],
    });
  };

  const direction = settings.data?.study_direction;

  return (
    <div id="aim-panel" className={open ? "aim-panel-shell open" : "aim-panel-shell"}>
      <div className="aim-panel-inner">
        <div className="aim-panel" inert={!open}>
          {!online ? <p className="hint">Потрібен звʼязок.</p> : null}

          <div className="sec-h aim-panel-h1">Напрямок</div>
          <div className="seg" role="group" aria-label="Напрямок навчання">
            {DIRECTIONS.map((item) => (
              <button
                key={item.value}
                className={direction === item.value ? "on" : ""}
                type="button"
                aria-pressed={direction === item.value}
                disabled={!online || updateSettings.isPending}
                onClick={() => updateSettings.mutate({ study_direction: item.value })}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="sec-h">Групи слів</div>

          {rows.length > SEARCH_AT ? (
            <input
              className="aim-search"
              type="search"
              value={query}
              placeholder="Знайти список"
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}

          <button
            className={aimIsAll(aim) ? "aim-pick on" : "aim-pick"}
            type="button"
            disabled={!online || !study.ready}
            onClick={() => void setAim({ listIds: [], unlisted: false })}
          >
            <span className="aim-pick-name">усі слова</span>
          </button>

          <div className="aim-sep" />

          {hot.map((row) => (
            <button
              key={row.id ?? "unlisted"}
              className={row.picked ? "aim-pick on" : "aim-pick"}
              type="button"
              disabled={!online || !study.ready}
              onClick={() => pick(row.id)}
            >
              <span className="aim-pick-name">{row.name}</span>
              <span className="aim-pick-num">{row.dueCount}</span>
            </button>
          ))}

          {cold.length > 0 ? (
            <>
              <div className="aim-sep" />
              {tailOpen ? (
                cold.map((row) => (
                  <button
                    key={row.id ?? "unlisted"}
                    className="aim-pick cold"
                    type="button"
                    disabled={!online || !study.ready}
                    onClick={() => pick(row.id)}
                  >
                    <span className="aim-pick-name">{row.name}</span>
                    <span className="aim-pick-num">0</span>
                  </button>
                ))
              ) : (
                <button
                  className="aim-tail"
                  type="button"
                  onClick={() => setTailOpen(true)}
                >
                  ще {cold.length} без повторень
                </button>
              )}
            </>
          ) : null}

          {filtered.length === 0 && rows.length > 0 ? (
            <p className="hint">Списків із такою назвою немає.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
