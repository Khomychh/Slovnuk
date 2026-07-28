/**
 * «Словник» — корінь вкладки.
 *
 * Плоский список усіх слів, списки працюють як фільтр-мітки (ADR-0011). Пошук і
 * фільтр рахує сервер: при пагінації по 50 фільтрація по завантаженому тихо
 * брехала б — слово є, але воно на сороковій сторінці.
 *
 * Рядок навмисно бідний: без крапки «час повторити» (після імпорту прострочені
 * всі доріжки, і вона стояла б на кожному рядку) і без тегів списків (540 із
 * 608 карток лежать в одному списку, тобто тег не ніс би інформації).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { Screen } from "../ui/parts";
import { senseSummary, distinctTranscriptions, type Card } from "../vocabulary/card";
import {
  EMPTY_BROWSE,
  flatten,
  useCards,
  useLists,
  type Browse,
} from "../vocabulary/queries";
import ListFilterSheet from "../vocabulary/ListFilterSheet";
import { lists as listsLabel, words } from "../ui/plural";

function CardRow({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const summary = senseSummary(card);
  const transcriptions = distinctTranscriptions(card);
  // Довге «слово» — не рідкість: у словнику є цілі речення на 61 символ. Тоді
  // транскрипція поруч не поміститься, і показувати її не варто.
  const longWord = card.word.length > 24;

  return (
    <button className="v-row" type="button" onClick={onOpen}>
      <span className="v-word-line">
        <span className="v-word">{card.word}</span>
        {!longWord && transcriptions.length > 0 ? (
          <span className="v-ipa">{transcriptions.join(" · ")}</span>
        ) : null}
        {card.forms.length > 0 ? <span className="v-tag">форми</span> : null}
      </span>
      {summary ? <span className="v-tr">{summary}</span> : null}
    </button>
  );
}

export default function VocabularyScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();

  const [browse, setBrowse] = useState<Browse>(EMPTY_BROWSE);
  const [draftQuery, setDraftQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const openCard = (id: number) => {
    // background — щоб маршрут картки намалювався аркушем ПОВЕРХ списку:
    // список лишається змонтованим, і позиція скролу не гине.
    navigate(`/vocabulary/cards/${id}`, { state: { background: location } });
  };

  return (
    <Screen eyebrow="словник" title="Мої слова" aside={<ProfileAvatar />}>
      <div className="v-summary">
        {words(total)} · {listsLabel(listCount)}
      </div>

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
        <button
          className="v-sort"
          type="button"
          onClick={() =>
            setBrowse((current) => ({
              ...current,
              sort: current.sort === "created" ? "word" : "created",
            }))
          }
        >
          {browse.sort === "created" ? "нові зверху" : "за абеткою"}
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
          <CardRow key={card.id} card={card} onOpen={() => openCard(card.id)} />
        ))}
      </div>

      <div ref={sentinel} />
      {cards.isFetchingNextPage ? <div className="hint">Ще…</div> : null}

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
    </Screen>
  );
}
