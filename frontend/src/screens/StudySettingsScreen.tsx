/**
 * «Налаштування» — звідки береться черга.
 *
 * Дві речі різної природи в одному місці: які групи слів беруться в чергу (це
 * живе на цьому пристрої й не їде за акаунтом) і яким боком показувати картку
 * (це преференція користувача, вона на сервері). Разом вони тому, що людина
 * ходить до них однією думкою — «що я вчу зараз»; підписані окремо тому, що
 * речі різні.
 *
 * До цього все це було панеллю під кнопкою «Вчити», де кожен із двох рядків
 * доводилось розгортати. На власному екрані розгортати нічого не треба — усе
 * видно одразу, і в цьому весь сенс переїзду.
 *
 * Черга перезапитується на ВИХІД з екрана, а не на кожен дотик. Вибір
 * переводять дотиками: обрав три групи, передумав, зняв одну. Запит на кожен
 * дотик означав би чотири повні вибірки по 50 карток, з яких три викидаються,
 * не доїхавши. Вихід із екрана і є те «Готово», якого тут немає: кнопка була б
 * підписом до жесту, який людина й так робить.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { Screen } from "../ui/parts";
import { useLists, useSettings, useStudy, useUpdateSettings } from "../study/queries";
import { aimIsAll } from "../study/session";
import { DIRECTIONS, aimRows, splitRows } from "../study/aim";
import { aimSettled, init, setAim } from "../study/store";

/** З якої кількості рядків зʼявляється пошук. Нижче — шукати довше, ніж глянути. */
const SEARCH_AT = 12;

export default function StudySettingsScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const study = useStudy();
  const lists = useLists();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  const [query, setQuery] = useState("");
  const [tailOpen, setTailOpen] = useState(false);

  // Сховище піднімається і тут, а не тільки на «Сьогодні». Без цього екран,
  // відкритий першим (пряме посилання, відновлена вкладка PWA), читав би
  // непіднятий стан — тобто порожній вибір, тобто «усі слова». Виглядало б це
  // не як «ще не прочитано», а як знятий вибір, і перший же дотик по рядку
  // записав би цю неправду поверх справжнього вибору в IndexedDB.
  useEffect(() => {
    void init();
  }, []);

  // Пішли з екрана — час іти по нову чергу. Саме на розмонтування, а не на
  // кнопку «назад»: вийти звідси можна ще й системним жестом і перемиканням
  // вкладки, а черга після зміни вибору мусить перезапитатись у всіх трьох
  // випадках. Сам `aimSettled` мовчки нічого не робить, коли вибір не міняли.
  useEffect(() => () => void aimSettled(), []);

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
    <Screen title="Налаштування" back={() => navigate(-1)}>
      {!online ? <p className="hint">Потрібен звʼязок.</p> : null}

      <div className="sec-h">Напрямок</div>
      {/* Сегментний перемикач, а не чипи: варіантів рівно три, вони
          взаємовиключні й завжди вміщаються в рядок. Три злитих сегменти
          показують це самою формою — чипи ж однаково виглядають і там, де
          можна обрати кілька. */}
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
            <button className="aim-tail" type="button" onClick={() => setTailOpen(true)}>
              ще {cold.length} без повторень
            </button>
          )}
        </>
      ) : null}

      {filtered.length === 0 && rows.length > 0 ? (
        <p className="hint">Списків із такою назвою немає.</p>
      ) : null}
    </Screen>
  );
}
