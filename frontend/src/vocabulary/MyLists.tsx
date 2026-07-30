/**
 * Керування списками — половина «Мої» на екрані «Списки».
 *
 * Створити, перейменувати, віддати, видалити, позначити за замовчуванням.
 * Ручного порядку немає — усі списки створюються з `position = 0`, тобто
 * бекенд віддає їх у порядку створення, і на восьми списках перестановка
 * вирішувала б проблему, якої ще немає.
 *
 * Дії в рядку — голі іконки, а не підписи. Підписів було рівно стільки, що
 * «Перейменувати» довелось скоротити до «Перейм.», і четвертій дії місця вже не
 * лишалось: на телефоні 360px під рядок є 320px, з яких обрамлені кнопки з'їли б
 * 192px і назви почали б різатись на 16 символах («Фразові дієслова»).
 *
 * Під рядком — смуга-частка: ширина дорівнює частці словника, що лежить у цьому
 * списку (`listFraction`). Це п'ятий масштаб стрічки сяйва і єдиний носій
 * насиченого кольору тут; решта половини — холодні нейтралі (ADR-0012).
 * Половина «Бібліотека» кольору майже не має, і ця різниця свідома: сяйво
 * означає, що слова твої.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { PencilIcon, PlusIcon, ShareIcon, TrashIcon } from "../ui/parts";
import ConfirmSheet from "../ui/ConfirmSheet";
import {
  useCreateList,
  useDeleteList,
  useLists,
  useRenameList,
  useVocabularyStats,
} from "./queries";
import { listFraction, listStateLine } from "./card";
import { useSettings, useUpdateSettings } from "../study/queries";
import { plural, words } from "../ui/plural";

export default function MyLists() {
  const navigate = useNavigate();
  const online = useOnline();

  const lists = useLists();
  const stats = useVocabularyStats();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const create = useCreateList();
  const rename = useRenameList();
  const remove = useDeleteList();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Який саме список питають видалити. Рядків багато — прапорця тут мало. */
  const [asking, setAsking] = useState<{
    id: number;
    name: string;
    cardCount: number;
  } | null>(null);

  const defaultListId = settings.data?.default_list_id ?? null;
  const items = lists.data?.items ?? [];
  // Знаменник смуги — усі картки користувача, а не сума по списках: списки це
  // мітки, тож картка може лежати у двох, а може ні в одному.
  const totalCards = stats.data?.cards ?? 0;

  const add = async () => {
    setError(null);
    if (!name.trim()) return;
    try {
      await create.mutateAsync(name.trim());
      setName("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Не вдалось створити");
    }
  };

  const onRename = async (id: number, current: string) => {
    const next = window.prompt("Нова назва списку", current);
    if (!next || next.trim() === current) return;
    setError(null);
    try {
      await rename.mutateAsync({ id, name: next.trim() });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Не вдалось перейменувати");
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

  const setDefault = async (id: number) => {
    // Повторне натискання знімає позначку: null тут означає дію, а не «не
    // передали» — так влаштований PATCH /study/settings/.
    await updateSettings.mutateAsync({
      default_list_id: defaultListId === id ? null : id,
    });
  };

  return (
    <>
      <div className="ed-label">Новий список</div>
      <div className="ed-inline">
        <input
          placeholder="назва"
          value={name}
          disabled={!online}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          className="row-icon"
          type="button"
          aria-label="Додати список"
          title="Додати список"
          disabled={!online || !name.trim() || create.isPending}
          onClick={add}
        >
          <PlusIcon />
        </button>
      </div>

      {error ? <div className="msg msg-error">{error}</div> : null}

      <div className="ed-label">Мої списки</div>
      {items.map((list) => (
        <div className="list-item" key={list.id}>
          <div className="list-row">
            <div className="list-row-main">
              <div className="list-row-name">{list.name}</div>
              <div className="list-row-sub">
                {listStateLine(list, list.id === defaultListId)}
              </div>
            </div>
            <button
              className={
                list.id === defaultListId ? "row-icon list-star on" : "row-icon list-star"
              }
              type="button"
              disabled={!online}
              aria-label="Список за замовчуванням"
              title="Нові слова потраплятимуть сюди"
              onClick={() => setDefault(list.id)}
            >
              ★
            </button>
            <button
              className="row-icon"
              type="button"
              disabled={!online}
              aria-label={`Віддати список «${list.name}»`}
              // Не «Спільне посилання»: за цією іконкою обидва способи віддати
              // список — посилання й Бібліотека, — і тепер вони на одному екрані.
              title="Віддати іншим"
              onClick={() => navigate(`/vocabulary/lists/${list.id}/share`)}
            >
              <ShareIcon />
            </button>
            <button
              className="row-icon"
              type="button"
              disabled={!online}
              aria-label={`Перейменувати «${list.name}»`}
              title="Перейменувати"
              onClick={() => onRename(list.id, list.name)}
            >
              <PencilIcon />
            </button>
            <button
              className="row-icon row-icon-danger"
              type="button"
              disabled={!online}
              aria-label={`Видалити «${list.name}»`}
              title="Видалити"
              onClick={() =>
                setAsking({
                  id: list.id,
                  name: list.name,
                  cardCount: list.card_count,
                })
              }
            >
              <TrashIcon />
            </button>
          </div>
          {/* Ширина — частка словника. Порожній словник дає нуль, і смуга
              лишається волосяною лінією, а не зникає разом із межею рядка. */}
          <div
            className="list-frac"
            style={{ "--frac": `${listFraction(list.card_count, totalCards)}%` } as React.CSSProperties}
          />
        </div>
      ))}

      {lists.data && lists.data.unlisted.card_count > 0 ? (
        <div className="hint">
          Без списку: {words(lists.data.unlisted.card_count)}. Це не список — його не
          можна перейменувати чи видалити.
        </div>
      ) : null}

      {!online ? <div className="hint">Зміни потребують звʼязку.</div> : null}

      {asking ? (
        <ConfirmSheet
          title={`Видалити список «${asking.name}»?`}
          // Наслідок мусить казати правду: старий PWA видаляв разом зі списком
          // усі його слова, і звичка може лишитись саме та.
          note={
            asking.cardCount === 0
              ? "Слів у ньому немає."
              : `${words(asking.cardCount)} ${plural(asking.cardCount, "залишиться", "залишаться", "залишаться")} у вашому словнику — ${plural(asking.cardCount, "воно перейде", "вони перейдуть", "вони перейдуть")} у «Без списку».`
          }
          confirmLabel="Видалити список"
          busy={remove.isPending}
          onConfirm={() => void onDelete(asking.id)}
          onCancel={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}
