/**
 * Керування списками.
 *
 * Створити, перейменувати, поділитись, видалити, позначити за замовчуванням.
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
 * насиченого кольору тут; решта екрана — холодні нейтралі (ADR-0012).
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import {
  PencilIcon,
  PlusIcon,
  Screen,
  ShareIcon,
  TrashIcon,
} from "../ui/parts";
import {
  useCreateList,
  useDeleteList,
  useLists,
  useRenameList,
  useVocabularyStats,
} from "../vocabulary/queries";
import { listFraction, listStateLine } from "../vocabulary/card";
import { useSettings, useUpdateSettings } from "../study/queries";
import { lists as listsLabel, plural, words } from "../ui/plural";

export default function ListsScreen() {
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

  const onDelete = async (id: number, listName: string, cardCount: number) => {
    // Діалог мусить казати правду: старий PWA видаляв разом зі списком усі його
    // слова, і звичка може лишитись саме та.
    const tail =
      cardCount === 0
        ? "Слів у ньому немає."
        : `${words(cardCount)} ${plural(cardCount, "залишиться", "залишаться", "залишаться")} у вашому словнику — ${plural(cardCount, "воно перейде", "вони перейдуть", "вони перейдуть")} у «Без списку».`;
    if (!window.confirm(`Список «${listName}» буде видалено. ${tail}`)) return;

    setError(null);
    try {
      await remove.mutateAsync(id);
    } catch (problem) {
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
    <Screen
      title="Списки"
      back={() => navigate(-1)}
      aside={
        items.length > 0 ? (
          <div className="head-count">{listsLabel(items.length)}</div>
        ) : undefined
      }
    >
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
              aria-label={`Поділитись списком «${list.name}»`}
              title="Спільне посилання"
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
              onClick={() => onDelete(list.id, list.name, list.card_count)}
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
    </Screen>
  );
}
