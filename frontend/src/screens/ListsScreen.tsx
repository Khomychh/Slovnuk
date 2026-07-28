/**
 * Керування списками.
 *
 * Рівень 1: створити, перейменувати, видалити, позначити за замовчуванням.
 * Ручного порядку немає — усі списки створюються з `position = 0`, тобто
 * бекенд віддає їх у порядку створення, і на восьми списках перестановка
 * вирішувала б проблему, якої ще немає. «Поділитись» теж немає: власницька
 * половина шеру без екрана прийому — це блок 7 наполовину.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { Screen } from "../ui/parts";
import {
  useCreateList,
  useDeleteList,
  useLists,
  useRenameList,
} from "../vocabulary/queries";
import { useSettings, useUpdateSettings } from "../study/queries";
import { plural, words } from "../ui/plural";

export default function ListsScreen() {
  const navigate = useNavigate();
  const online = useOnline();

  const lists = useLists();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const create = useCreateList();
  const rename = useRenameList();
  const remove = useDeleteList();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const defaultListId = settings.data?.default_list_id ?? null;

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
    <Screen eyebrow="словник" title="Списки">
      <button className="btn-quiet" type="button" onClick={() => navigate(-1)}>
        ‹ Назад
      </button>

      <div className="ed-label">Новий список</div>
      <div className="ed-form">
        <input
          placeholder="назва"
          value={name}
          disabled={!online}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          className="btn-link"
          type="button"
          disabled={!online || !name.trim() || create.isPending}
          onClick={add}
        >
          Додати
        </button>
      </div>

      {error ? <div className="msg msg-error">{error}</div> : null}

      <div className="ed-label">Мої списки</div>
      {(lists.data?.items ?? []).map((list) => (
        <div className="list-row" key={list.id}>
          <div className="list-row-main">
            <div className="list-row-name">{list.name}</div>
            <div className="list-row-sub">
              {words(list.card_count)}
              {list.id === defaultListId ? " · за замовчуванням" : ""}
            </div>
          </div>
          <button
            className={list.id === defaultListId ? "list-star on" : "list-star"}
            type="button"
            disabled={!online}
            aria-label="Список за замовчуванням"
            title="Нові слова потраплятимуть сюди"
            onClick={() => setDefault(list.id)}
          >
            ★
          </button>
          <button
            className="btn-link"
            type="button"
            disabled={!online}
            onClick={() => onRename(list.id, list.name)}
          >
            Перейм.
          </button>
          <button
            className="btn-link"
            type="button"
            disabled={!online}
            onClick={() => onDelete(list.id, list.name, list.card_count)}
          >
            Видалити
          </button>
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
