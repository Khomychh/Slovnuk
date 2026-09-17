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
import { ApiError } from "../api/client";
import { useOnline } from "../app/useOnline";
import { PencilIcon, PlusIcon, SaveIcon, ShareIcon, TrashIcon } from "../ui/parts";
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

/** Сервер пише помилки англійською; назву, що вже зайнята, кажемо своїми словами. */
function listProblem(problem: unknown, fallback: string): string {
  if (problem instanceof ApiError && problem.code === "list_exists") {
    return "Список із такою назвою вже є.";
  }
  return problem instanceof Error ? problem.message : fallback;
}

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
  /** Список, чия назва зараз стоїть полем у власному рядку. */
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
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
      setError(listProblem(problem, "Не вдалось створити"));
    }
  };

  const cancelRename = () => {
    setEditing(null);
    setError(null);
  };

  const saveRename = async (current: string) => {
    // Поле під час запиту не гаситься (гасіння забирало фокус), тож повторний Enter відсікається тут.
    if (!editing || rename.isPending) return;
    const next = editing.name.trim();
    if (!next || next === current) {
      setEditing(null);
      return;
    }
    setError(null);
    try {
      await rename.mutateAsync({ id: editing.id, name: next });
      setEditing(null);
    } catch (problem) {
      // Поле лишається відкритим: назву, яку не прийняли, виправляють на місці.
      setError(listProblem(problem, "Не вдалось перейменувати"));
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
      {error ? <div className="msg msg-error lists-msg">{error}</div> : null}

      {/* Списки й поле нового — одна картка: це один предмет, «мої списки»,
          і новий рядок народжується там само, де житиме. */}
      <div className="panel lists-panel">
        {items.map((list) => (
          <div className="list-item" key={list.id}>
            {editing?.id === list.id ? (
              // Перейменування на місці: назва стає полем у тому ж рядку.
              <form
                className="list-row list-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveRename(list.name);
                }}
              >
                <input
                  autoFocus
                  aria-label={`Нова назва для «${list.name}»`}
                  value={editing.name}
                  disabled={!online}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) =>
                    setEditing({ id: list.id, name: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") cancelRename();
                  }}
                />
                <button
                  className="row-icon row-icon-on"
                  type="submit"
                  aria-label="Зберегти назву"
                  title="Зберегти"
                  disabled={!online || !editing.name.trim() || rename.isPending}
                >
                  <SaveIcon />
                </button>
                <button
                  className="row-icon row-icon-close"
                  type="button"
                  aria-label="Скасувати перейменування"
                  title="Скасувати"
                  onClick={cancelRename}
                >
                  ×
                </button>
              </form>
            ) : (
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
                  onClick={() => {
                    setError(null);
                    setEditing({ id: list.id, name: list.name });
                  }}
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
            )}
            {/* Ширина — частка словника. Порожній словник дає нуль, і смуга
                лишається волосяною лінією, а не зникає разом із межею рядка. */}
            <div
              className="list-frac"
              style={{ "--frac": `${listFraction(list.card_count, totalCards)}%` } as React.CSSProperties}
            />
          </div>
        ))}

        <form
          className="lists-new"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input
            placeholder="Новий список"
            aria-label="Назва нового списку"
            value={name}
            disabled={!online}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className="row-icon"
            type="submit"
            aria-label="Додати список"
            title="Додати список"
            disabled={!online || !name.trim() || create.isPending}
          >
            <PlusIcon />
          </button>
        </form>
      </div>

      {/* Поза карткою й без дій: це не список, а слова, що не лежать ні в якому. */}
      {lists.data && lists.data.unlisted.card_count > 0 ? (
        <div className="lists-unlisted">
          <span>Без списку</span>
          <span className="list-row-sub">
            {words(lists.data.unlisted.card_count)}
          </span>
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
