/**
 * «Бібліотека» — корінь вкладки.
 *
 * Витрина списків, виставлених на загал. Тут **тільки чуже** в тому сенсі, що
 * власного словника тут немає, — але свої публікації з витрини НЕ ховаються:
 * автор має бачити свій список там, де його бачать інші.
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
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { Message, Screen } from "../ui/parts";
import { useLibrary } from "../library/queries";
import {
  authorLine,
  derivedLine,
  ratingLine,
  reachLine,
  SORT_LABELS,
  updatedLine,
} from "../library/library";
import type { LibrarySort, PublicationSummary } from "../api/library";

const SORTS: LibrarySort[] = ["popular", "fresh", "rating"];

/**
 * Рядок витрини.
 *
 * Другий рядок — це справжні слова зі списку, а НЕ опис автора. Чотири слова
 * кажуть про рівень і тему більше, ніж будь-яке речення: «get up · put off ·
 * run into» одразу видно, що це фразові дієслова й що це B1. Опис читається на
 * сторінці публікації, де для нього є місце.
 *
 * Насиченого кольору тут немає жодного, і це не забутість. У цьому застосунку
 * колір означає рівно одне — наскільки ти знаєш слово (ADR-0012, ADR-0017).
 * Чужий список температури не має: жодне слово в ньому тобі ще не належить.
 * Пофарбувати витрину означало б збрехати рампою. Колір приходить тоді, коли
 * слова стають твоїми й заходять у словник.
 */
function Row({
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
  const rating = ratingLine(publication);

  return (
    <button className="lib-row" type="button" onClick={onOpen}>
      <div className="lib-row-head">
        <span className="lib-title">{publication.title}</span>
        {/* Неоцінена публікація не пише про це нічого: порожнє місце праворуч
            читається швидше за «поки без оцінок». */}
        {rating ? <span className="lib-rating">{rating}</span> : null}
      </div>

      {sample.length > 0 ? (
        <div className="lib-words">
          {sample.map((word, index) => (
            <span key={`${word}#${index}`}>
              {index > 0 ? <span className="lib-words-sep">·</span> : null}
              {word}
            </span>
          ))}
          {publication.cards_count > sample.length ? (
            <span className="lib-words-sep">…</span>
          ) : null}
        </div>
      ) : null}

      {/* Один метарядок, не два: «оновлено 30 липня» окремим рядком важило
          більше, ніж вартує.

          Роздільники малює CSS через `span + span::before`, а не розмітка. На
          самому `gap` рядок злипався в «Іван Хомич 14 слів»; окремими ж
          `<span>·</span>` роздільник міг зостатись самотнім у кінці рядка при
          переносі на вузькому екрані. Приліплений до наступного шматка, він
          відірватись не може. */}
      <div className="lib-meta">
        <span>{authorLine(publication.author)}</span>
        <span>{reachLine(publication)}</span>
        <span>{updatedLine(publication.content_updated_at)}</span>
        {publication.is_taken ? <span className="lib-taken">взято ✓</span> : null}
      </div>

      {derived ? <div className="lib-derived">↳ {derived}</div> : null}
    </button>
  );
}

export default function LibraryScreen() {
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
    /*
     * Заголовок один і дорівнює назві вкладки — як на «Словнику», «Граматиці» й
     * «Прогресі». Рубрика над ним була б повтором того самого слова: на
     * «Сьогодні» вона є лише тому, що несе дату, тобто справжню інформацію.
     *
     * Лічильника в шапці теж немає: голе «1» у правому куті не значить нічого, а
     * скільки публікацій у Бібліотеці — не те, за чим сюди приходять. Приходять
     * за словами.
     */
    <Screen title="Бібліотека" aside={<ProfileAvatar />}>
      {/* `.v-search`, а не `.ed-inline`: другий — це «поле плюс кнопка» (як
          «Новий список» у «Списках»), а тут самотній пошук, тобто рівно те, що
          вже є у «Словнику». Разом із класом приходять і налаштування мобільної
          клавіатури, яких я був не поставив. */}
      <input
        className="v-search lib-search"
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

      {items.map((publication) => (
        <Row
          key={publication.id}
          publication={publication}
          onOpen={() => navigate(`/library/${publication.id}`)}
        />
      ))}

      <div ref={sentinel} />
      {library.isFetchingNextPage ? <div className="hint">Ще…</div> : null}
    </Screen>
  );
}
