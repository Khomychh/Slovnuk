/**
 * «Словник» — корінь вкладки.
 *
 * Плоский список усіх слів, списки працюють як фільтр-мітки (ADR-0011). Пошук і
 * фільтр рахує сервер: при пагінації по 50 фільтрація по завантаженому тихо
 * брехала б — слово є, але воно на сороковій сторінці.
 *
 * Сам рядок живе в `vocabulary/CardRow` — його малює ще й «Сьогодні». Разом із
 * порядком «спершу холодні» температура на його лівій рисці робить прокрутку
 * словника розгорнутою тепловою смугою «Прогресу»: та сама величина, ті самі
 * чотири зупинки.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { ListsIcon, Screen } from "../ui/parts";
import {
  EMPTY_BROWSE,
  flatten,
  useCards,
  useDeleteCards,
  useLists,
  type Browse,
} from "../vocabulary/queries";
import { deletionLosesHistory, type Card } from "../vocabulary/card";
import ConfirmSheet from "../ui/ConfirmSheet";
import CardRow from "../vocabulary/CardRow";
import ListFilterSheet from "../vocabulary/ListFilterSheet";
import SortSheet from "../vocabulary/SortSheet";
import { lists as listsLabel, plural, words } from "../ui/plural";
import type { CardSort } from "../api/vocabulary";

/** «run, walk, talk і ще 4» — щоб у підтвердженні було видно, що саме зникне. */
function namePicked(picked: Card[]): string {
  const shown = picked.slice(0, 3).map((card) => card.word);
  const rest = picked.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} і ще ${rest}` : shown.join(", ");
}

/** Наслідок тими самими словами, що при видаленні списку разом зі словами. */
function pickedNote(picked: Card[]): string {
  const studied = picked.filter(deletionLosesHistory).length;
  if (studied === 0) {
    return `${plural(picked.length, "Воно зникне", "Вони зникнуть", "Вони зникнуть")} зі словника.`;
  }
  return studied === picked.length
    ? `Разом ${plural(studied, "з ним", "з ними", "з ними")} зникне історія повторень, і відновити її не вийде.`
    : `У ${studied} з них зникне й історія повторень, і відновити її не вийде.`;
}

/** Ті самі слова, що в аркуші: кнопка каже, у якому порядку ти зараз. */
const SORT_LABEL: Record<CardSort, string> = {
  created: "нові зверху",
  word: "за абеткою",
  stability: "спершу холодні",
};

export default function VocabularyScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();

  /*
   * Фільтр списку не адресується посиланням навмисно (позиція скролу й набраний
   * пошук не повинні гинути від зміни URL), тож прийти «у конкретний список»
   * можна лише станом навігації. Це робить звіт після імпорту чужого списку:
   * інакше людина шукала б свіжозабраний список руками в аркуші фільтра.
   */
  const [browse, setBrowse] = useState<Browse>(() => {
    const incoming = (location.state as { listId?: number } | null)?.listId;
    return typeof incoming === "number"
      ? { ...EMPTY_BROWSE, listId: incoming }
      : EMPTY_BROWSE;
  });
  const [draftQuery, setDraftQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  /*
   * Вибрані картки, а не лише id: вибір переживає зміну пошуку й фільтра, тож
   * підтвердження мусить назвати й ті слова, яких на екрані вже немає.
   * `null` — режиму вибору немає. «Вибрати всі» немає навмисно (ADR-0035).
   */
  const [picked, setPicked] = useState<Map<number, Card> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const removeCards = useDeleteCards();

  // Пошук іде на сервер, тож набір тексту не має слати запит на кожну літеру.
  useEffect(() => {
    const timer = setTimeout(
      () => setBrowse((current) => ({ ...current, q: draftQuery })),
      300,
    );
    return () => clearTimeout(timer);
  }, [draftQuery]);

  const lists = useLists();
  const cards = useCards(browse);
  const items = useMemo(() => flatten(cards.data?.pages), [cards.data]);

  const total = cards.data?.pages[0]?.total ?? 0;
  const listCount = lists.data?.items.length ?? 0;

  const activeName = browse.unlisted
    ? "Без списку"
    : browse.listId === null
      ? "Усі слова"
      : (lists.data?.items.find((item) => item.id === browse.listId)?.name ??
        "Список");

  // Дозавантаження: сторожовий елемент у кінці списку. Кнопка «показати ще»
  // теж працювала б, але на 13 сторінках це 13 натискань.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cards.hasNextPage) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !cards.isFetchingNextPage) {
        void cards.fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cards.hasNextPage, cards.isFetchingNextPage, cards.fetchNextPage, cards]);

  const toggle = (card: Card) =>
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(card.id)) next.delete(card.id);
      else next.set(card.id, card);
      return next;
    });

  const pickedCards = picked ? [...picked.values()] : [];

  const destroyPicked = async () => {
    setDeleteError(null);
    try {
      await removeCards.mutateAsync(pickedCards.map((card) => card.id));
      setPicked(null);
    } catch (problem) {
      setDeleteError(problem instanceof Error ? problem.message : "Не вдалось видалити");
    }
    setConfirmDelete(false);
  };

  const openCard = (id: number) => {
    // background — щоб маршрут картки намалювався аркушем ПОВЕРХ списку:
    // список лишається змонтованим, і позиція скролу не гине.
    navigate(`/vocabulary/cards/${id}`, { state: { background: location } });
  };

  return (
    <Screen
      title="Словник"
      foot={
        picked ? (
          // Вихід із режиму — тут, а не вгорі: верх їде разом із прокруткою.
          <div className="v-select-foot">
            <button
              className="btn-quiet v-select-cancel"
              type="button"
              onClick={() => {
                setDeleteError(null);
                setPicked(null);
              }}
            >
              Скасувати
            </button>
            <button
              className="btn-quiet v-select-act"
              type="button"
              disabled={!online || picked.size === 0}
              title={online ? undefined : "Потрібен звʼязок"}
              onClick={() => setConfirmDelete(true)}
            >
              {picked.size === 0 ? "Виберіть слова" : `Видалити ${words(picked.size)}`}
            </button>
          </div>
        ) : undefined
      }
      /* Два органи в правому куті, і це єдина шапка, де їх два.
         «Списки» стоять саме тут, бо звідси в них і ходять: керувати списками —
         це робота над словником, а не окрема справа. Аватар лишається на місці
         на всіх коренях: він єдиний вхід у профіль (ADR-0021).

         Кольором вони не сперечаються: аватар — фото в колі, «Списки» — штрих,
         залитий стрічкою сяйва. Сплутати їх ніяк. */
      aside={
        <div className="head-tools">
          <button
            className="icon-btn icon-btn-bare head-lists"
            type="button"
            aria-label="Списки"
            title="Списки й Бібліотека"
            onClick={() => navigate("/vocabulary/lists")}
          >
            <ListsIcon />
          </button>
          <ProfileAvatar />
        </div>
      }
    >
      <div className="v-summary">
        <span>
          {words(total)} · {listsLabel(listCount)}
        </span>
        {/* У режимі вибору лише ховається: рядок не має міняти висоту. */}
        <button
          className={picked ? "v-select v-select-off" : "v-select"}
          type="button"
          disabled={Boolean(picked) || !online || items.length === 0}
          aria-hidden={picked ? true : undefined}
          onClick={() => {
            setDeleteError(null);
            setPicked(new Map());
          }}
        >
          Вибрати
        </button>
      </div>

      {deleteError ? <div className="msg msg-error">{deleteError}</div> : null}

      <input
        className="v-search"
        type="search"
        inputMode="search"
        autoCapitalize="none"
        autoComplete="off"
        placeholder="Пошук: слово, переклад, форма"
        value={draftQuery}
        disabled={!online}
        onChange={(event) => setDraftQuery(event.target.value)}
      />
      {!online ? (
        <div className="hint">Пошук потребує звʼязку — показано збережене.</div>
      ) : null}

      <div className="v-controls">
        <button
          className="v-filter"
          type="button"
          onClick={() => setSheetOpen(true)}
        >
          {activeName} ▾
        </button>
        <button className="v-sort" type="button" onClick={() => setSortOpen(true)}>
          {SORT_LABEL[browse.sort]} ▾
        </button>
      </div>

      {cards.isPending ? <div className="hint">Завантаження…</div> : null}

      {cards.isError && items.length === 0 ? (
        <div className="hint">
          {online
            ? "Не вдалось завантажити словник."
            : "Немає звʼязку, а ці слова ще не завантажувались."}
        </div>
      ) : null}

      {!cards.isPending && items.length === 0 && !cards.isError ? (
        <div className="stub">
          {browse.q.trim()
            ? `За запитом «${browse.q.trim()}» нічого не знайшлось.`
            : "Тут поки порожньо. Додайте перше слово кнопкою «+»."}
        </div>
      ) : null}

      <div className="v-list">
        {items.map((card) => (
          <CardRow
            key={card.id}
            card={card}
            selected={picked ? picked.has(card.id) : undefined}
            onOpen={() => (picked ? toggle(card) : openCard(card.id))}
          />
        ))}
      </div>

      <div ref={sentinel} />
      {cards.isFetchingNextPage ? <div className="hint">Ще…</div> : null}

      {picked ? null : (
        <button
          className="v-add"
          type="button"
          disabled={!online}
          title={online ? "Додати слово" : "Потрібен звʼязок"}
          onClick={() =>
            navigate("/vocabulary/cards/new", {
              // Активний фільтр їде разом: «додати слово», не виходячи з
              // відкритого списку, має класти картку саме туди.
              state: { background: location, activeListId: browse.listId },
            })
          }
        >
          +
        </button>
      )}

      {confirmDelete && picked ? (
        <ConfirmSheet
          title={`Видалити ${words(picked.size)}?`}
          note={`${namePicked(pickedCards)}. ${pickedNote(pickedCards)}`}
          confirmLabel={`Видалити ${words(picked.size)}`}
          busy={removeCards.isPending}
          onConfirm={() => void destroyPicked()}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}

      {sheetOpen ? (
        <ListFilterSheet
          browse={browse}
          onPick={(next) => {
            setBrowse((current) => ({ ...current, ...next }));
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}

      {sortOpen ? (
        <SortSheet
          sort={browse.sort}
          onPick={(next) => {
            setBrowse((current) => ({ ...current, sort: next }));
            setSortOpen(false);
          }}
          onClose={() => setSortOpen(false)}
        />
      ) : null}
    </Screen>
  );
}
