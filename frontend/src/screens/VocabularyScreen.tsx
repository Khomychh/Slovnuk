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
 *
 * Єдине, що рядок каже понад текст, — температура на лівій рисці (ADR-0017).
 * Разом із порядком «спершу холодні» це робить прокрутку словника розгорнутою
 * тепловою смугою «Прогресу»: та сама величина, ті самі шість зупинок.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { ListsIcon, Screen } from "../ui/parts";
import { senseSummary, distinctTranscriptions, type Card } from "../vocabulary/card";
import {
  EMPTY_BROWSE,
  flatten,
  useCards,
  useLists,
  type Browse,
} from "../vocabulary/queries";
import ListFilterSheet from "../vocabulary/ListFilterSheet";
import SortSheet from "../vocabulary/SortSheet";
import { cardTemperature } from "../study/temperature";
import { SpeakButton } from "../tts/SpeakButton";
import { lists as listsLabel, words } from "../ui/plural";
import type { CardSort } from "../api/vocabulary";

/** Ті самі слова, що в аркуші: кнопка каже, у якому порядку ти зараз. */
const SORT_LABEL: Record<CardSort, string> = {
  created: "нові зверху",
  word: "за абеткою",
  stability: "спершу холодні",
};

function CardRow({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const summary = senseSummary(card);
  const transcriptions = distinctTranscriptions(card);
  // Довге «слово» — не рідкість: у словнику є цілі речення на 61 символ. Тоді
  // транскрипція поруч не поміститься, і показувати її не варто.
  const longWord = card.word.length > 24;

  // Рядок — не кнопка, а смуга з кнопкою всередині: динамік поруч мусить бути
  // окремим органом, а кнопка в кнопці недопустима в розмітці й непередбачувана
  // в поведінці.
  return (
    <div
      className="v-row"
      // Риска ліворуч несе температуру (ADR-0017). Підказкою вона тут бути не
      // може: поруч уже стоїть переклад, тобто ховати нічого — на відміну від
      // закритої картки навчання, де той самий колір заборонений (ADR-0016).
      style={{ "--temp": cardTemperature(card.tracks) } as React.CSSProperties}
    >
      <button className="v-row-main" type="button" onClick={onOpen}>
        <span className="v-word-line">
          <span className="v-word">{card.word}</span>
          {!longWord && transcriptions.length > 0 ? (
            <span className="v-ipa">{transcriptions.join(" · ")}</span>
          ) : null}
          {card.forms.length > 0 ? <span className="v-tag">форми</span> : null}
        </span>
        {summary ? <span className="v-tr">{summary}</span> : null}
      </button>
      <SpeakButton text={card.word} className="spk-row" />
    </div>
  );
}

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
    <Screen
      title="Словник"
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
