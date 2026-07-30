/**
 * Витрина — половина «Бібліотека» на екрані «Списки».
 *
 * Тут **тільки чуже** в тому сенсі, що власного словника тут немає, — але свої
 * публікації з витрини НЕ ховаються: автор має бачити свій список там, де його
 * бачать інші.
 *
 * Рядок несе два числа, і вони кажуть різне навмисно: рейтинг — про якість,
 * «взяли» — про охоплення. Список, який узяли 128 разів і оцінили на 3.2,
 * популярний і посередній одночасно, і вибирати має людина, а не наша формула.
 *
 * Рейтинг приходить уже прихованим: сервер віддає `null`, доки оцінок менше
 * трьох. Поріг тут не перераховується — він живе одним SQL-виразом на бекенді,
 * бо витрина сортує за рейтингом у базі.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OfflineError } from "../api/client";
import { useOnline } from "../app/useOnline";
import { Message } from "../ui/parts";
import { useLibrary } from "./queries";
import {
  authorLine,
  derivedLine,
  SORT_LABELS,
  updatedLine,
} from "./library";
import { words } from "../ui/plural";
import type { LibrarySort, PublicationSummary } from "../api/library";

const SORTS: LibrarySort[] = ["popular", "fresh", "rating"];

/**
 * Картка витрини.
 *
 * Слова — герой картки, а не опис автора. Чотири слова кажуть про рівень і тему
 * більше, ніж будь-яке речення: «get up · put off · run into» одразу видно, що
 * це фразові дієслова й що це B1. Опис читається на сторінці публікації, де для
 * нього є місце.
 *
 * Низ картки розділено на два голоси навмисно (ADR-0022): числа — моноширинні,
 * бо їх звіряють між картками очима по вертикалі; людина й дата — звичайним
 * шрифтом, бо це не дані, а підпис. Доки обидва рядки були однією моноширинною
 * стрічкою капсом, «ІВАН ХОМИЧ 128 30 ЛИПНЯ» читалось як одне сіре місиво.
 *
 * Кольору тут рівно два джерела, і жодне з них не бреше рампою (ADR-0012,
 * ADR-0022). Золото на зірці — оцінка, і це та сама золота зірка, якою в
 * «Моїх» позначено список за замовчуванням. Стрічка сяйва по верхньому краю
 * з'являється лише на **взятих** публікаціях: їхні слова справді приїхали в
 * твій словник, тож підпис застосунку тут доречний. Температури в чужого списку
 * немає й бути не може — жодне слово в ньому тобі ще не належить.
 */
function Card({
  publication,
  onOpen,
}: {
  publication: PublicationSummary;
  onOpen: () => void;
}) {
  const derived = derivedLine(publication.derived_from_title);
  /*
   * `?? []`, хоч схема обіцяє масив, і це не зайва обережність.
   *
   * Обіцянка типів тримається лише доки сервер відповідає схемі, а при розкатці
   * фронтенд приїжджає раніше за бекенд — і тоді поля просто немає. Без цього
   * рядок падав на `.length`, а React зносив УВЕСЬ екран у білий: замість
   * витрини без слів людина бачила порожнечу. Перевірено на живому сервері зі
   * старим кодом.
   */
  const sample = publication.sample_words ?? [];

  return (
    <button
      className={publication.is_taken ? "pub pub-taken" : "pub"}
      type="button"
      onClick={onOpen}
    >
      <span className="pub-title">{publication.title}</span>

      {sample.length > 0 ? (
        <span className="pub-words">
          {sample.map((word, index) => (
            <span key={`${word}#${index}`}>
              {index > 0 ? <span className="pub-sep">·</span> : null}
              {word}
            </span>
          ))}
          {publication.cards_count > sample.length ? (
            <span className="pub-sep">…</span>
          ) : null}
        </span>
      ) : null}

      {/* Числа в один рядок і моноширинні: їх звіряють між картками поглядом
          згори вниз, а пропорційний шрифт зсуває стовпчик на кожній цифрі.
          Рейтинг стоїть посередині — між розміром списку й охопленням, тобто
          між тим, «скільки» і «скільком». */}
      <span className="pub-figures">
        <span className="pub-figure">{words(publication.cards_count)}</span>
        {/* Неоцінена публікація не пише про це нічого: порожнє місце читається
            швидше за «поки без оцінок». */}
        {publication.rating !== null ? (
          <span className="pub-figure pub-rating">
            <span className="pub-star">★</span>
            {publication.rating.toFixed(1)}
            <span className="pub-of">({publication.ratings_count})</span>
          </span>
        ) : null}
        <span className="pub-figure">взяли {publication.takes_count}</span>
      </span>

      <span className="pub-by">
        {authorLine(publication.author)}
        <span className="pub-sep">·</span>
        {updatedLine(publication.content_updated_at)}
      </span>

      {derived ? <span className="pub-derived">↳ {derived}</span> : null}
    </button>
  );
}

export default function LibraryBrowse() {
  const navigate = useNavigate();
  const online = useOnline();

  const [sort, setSort] = useState<LibrarySort>("popular");
  const [query, setQuery] = useState("");
  /*
   * Пошук іде в запит із затримкою: кожна натиснута літера — це запит на
   * сервер, а «фразові» — це вісім запитів, з яких сім нікому не потрібні.
   */
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const library = useLibrary(sort, debounced);

  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !library.hasNextPage) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !library.isFetchingNextPage) {
        void library.fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    library.hasNextPage,
    library.isFetchingNextPage,
    library.fetchNextPage,
    library,
  ]);

  const items = library.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <input
        className="v-search"
        type="search"
        inputMode="search"
        autoCapitalize="none"
        autoComplete="off"
        value={query}
        placeholder="Пошук: назва або опис"
        disabled={!online}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="ed-chips lib-sorts">
        {SORTS.map((option) => (
          <button
            key={option}
            className={sort === option ? "chip chip-on" : "chip"}
            type="button"
            onClick={() => setSort(option)}
          >
            {SORT_LABELS[option]}
          </button>
        ))}
      </div>

      {!online ? (
        <div className="hint">
          Бібліотека живе в мережі — офлайн доступне лише навчання.
        </div>
      ) : null}

      {library.isError ? (
        <Message kind="error">
          {library.error instanceof OfflineError
            ? "Немає звʼязку."
            : library.error instanceof Error
              ? library.error.message
              : "Не вдалось завантажити"}
        </Message>
      ) : null}

      {library.isPending ? <div className="hint">Завантаження…</div> : null}

      {!library.isPending && items.length === 0 && !library.isError ? (
        <div className="stub">
          {debounced.trim()
            ? "За цим запитом нічого немає."
            : "Тут поки нічого немає. Опублікуйте свій список — і він з'явиться першим."}
        </div>
      ) : null}

      <div className="pub-list">
        {items.map((publication) => (
          <Card
            key={publication.id}
            publication={publication}
            onOpen={() => navigate(`/library/${publication.id}`)}
          />
        ))}
      </div>

      <div ref={sentinel} />
      {library.isFetchingNextPage ? <div className="hint">Ще…</div> : null}
    </>
  );
}
