/**
 * «Віддати список» — половина власника.
 *
 * Способів два, і вони різні майже в усьому: **посилання** конкретним людям
 * (`Шер`) і **публікація** на загал (`Бібліотека`). Раніше перший жив на цьому
 * екрані, а другий — за рядком-входом на наступному, тобто вибір між ними
 * робили, ще не побачивши другого варіанта. Тепер обидва стоять тут двома
 * рівноправними блоками однакової будови (ADR-0022): назва, одне речення про
 * наслідок, поточний стан, дія. Різницю видно з першого погляду, а не після
 * переходу.
 *
 * Пояснень, які раніше займали три абзаци, тут немає. Правила, що інакше
 * здивують, нікуди не поділись — вони переїхали туди, де від них є користь: у
 * підтвердження незворотних дій. «Посилання багаторазове й безадресне» нічого
 * не важить, доки посилання немає; «вимкнене не воскресає» важить рівно в мить,
 * коли палець над «Вимкнути».
 *
 * Стан посилання не питається окремим запитом: `share_token` уже їде в
 * `GET /vocabulary/lists/`, і саме тому рядок «Моїх» може сказати «поділено»
 * без запиту на кожен список. Так само працює `in_library`.
 */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { Message, Screen } from "../ui/parts";
import { useLists } from "../vocabulary/queries";
import { useListPublication } from "../library/queries";
import { useShareList, useUnshareList } from "../sharing/queries";
import { buildShareUrl } from "../sharing/share";
import { asOfLine } from "../library/library";
import { words } from "../ui/plural";
import { ApiError } from "../api/client";

export default function ListShareScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const params = useParams();
  const listId = Number(params.id);

  const lists = useLists();
  const share = useShareList();
  const unshare = useUnshareList();
  /*
   * Стан публікації читається вже тут, а не лише на її екрані: блок мусить
   * сказати «4.6★ · взяли 128», інакше він показував би саму назву й людина
   * заходила б усередину, щоб дізнатись, чи там узагалі щось є.
   */
  const publication = useListPublication(Number.isFinite(listId) ? listId : undefined);

  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = lists.data?.items.find((item) => item.id === listId);
  const back = () => navigate(-1);

  if (lists.isPending) {
    return <Screen back={back}>Завантаження…</Screen>;
  }
  if (!list) {
    return (
      <Screen back={back} title="Список не знайдено">
        <p className="hint">Можливо, його видалили з іншого пристрою.</p>
      </Screen>
    );
  }

  const token = list.share_token;
  const url = token ? buildShareUrl(window.location.origin, token) : null;

  /*
   * Стан таблетки береться з `list.in_library`, а НЕ з відповіді про публікацію.
   *
   * Список уже приїхав у `GET /vocabulary/lists/`, тобто це поле є завжди —
   * зокрема офлайн і доки запит публікації в польоті. Якби таблетку малювала
   * відповідь, вона казала б «не виставлено» щоразу, коли запит не дійшов, —
   * тобто саме тоді, коли перевірити нічим. Це не «ще не знаємо», а неправда.
   *
   * `current` лишається тільки для чисел: їх без відповіді просто немає, і
   * порожнє місце замість рейтингу нічого не стверджує.
   */
  const listed = list.in_library;

  // 404 — це нормальний стан «не опубліковано», а не помилка.
  const notPublished =
    publication.isError &&
    publication.error instanceof ApiError &&
    publication.error.status === 404;
  const current = notPublished ? null : (publication.data ?? null);

  const run = async (action: () => Promise<unknown>, done: string | null) => {
    setError(null);
    setNote(null);
    try {
      await action();
      if (done) setNote(done);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Не вдалось");
    }
  };

  const copy = async () => {
    if (!url) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(url);
      setNote("Посилання скопійовано.");
    } catch {
      // Буфер обміну доступний не завжди (старий WebView, відмова в дозволі).
      // Тоді посилання все одно видно й виділяється пальцем — це не тупик.
      setError("Не вдалось скопіювати. Виділіть посилання вручну.");
    }
  };

  const sendOut = async () => {
    if (!url) return;
    // Системний аркуш «поділитись» — те, чим на телефоні відправляють
    // посилання в месенджер. Його немає в десктопному браузері, тому це не
    // єдиний спосіб: копіювання лишається завжди.
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: list.name, text: list.name, url });
    } catch {
      /* людина закрила аркуш — це не помилка */
    }
  };

  const turnOff = async () => {
    // Тут і живуть тепер обидва правила шеру. До натискання вони були б
    // текстом, який ніхто не читає; у цю мить вони — єдине, що має значення.
    const message =
      `Посилання перестане працювати. Ті, хто вже взяв список, свої слова ` +
      `залишать — це копія, а не підписка. Увімкнути це саме посилання знову ` +
      `не можна: буде нове.`;
    if (!window.confirm(message)) return;
    await run(() => unshare.mutateAsync(listId), "Посилання вимкнено.");
  };

  const busy = share.isPending || unshare.isPending;

  return (
    <Screen back={back} title={list.name}>
      <div className="v-summary">{words(list.card_count)}</div>

      {error ? <Message kind="error">{error}</Message> : null}
      {note ? <Message>{note}</Message> : null}

      {/* --- посиланням ---------------------------------------------------- */}

      <div className="give">
        <div className="give-head">
          <span className="give-title">Посиланням</span>
          <span className={token ? "pill pill-on" : "pill"}>
            {token ? "увімкнено" : "вимкнено"}
          </span>
        </div>
        <p className="give-what">
          Кому даси посилання — той візьме собі копію цих слів.
        </p>

        {token && url ? (
          <>
            {/* Посилання видно цілком і його можна виділити пальцем: коли буфер
                обміну недоступний, це єдиний шлях, і ховати адресу за кнопкою
                означало б робити тупик. */}
            <div className="share-url">{url}</div>
            <div className="give-actions">
              <button
                className="btn btn-sm"
                type="button"
                disabled={!online}
                onClick={sendOut}
              >
                Поділитись
              </button>
              <button className="btn-quiet btn-sm" type="button" onClick={copy}>
                Копіювати
              </button>
            </div>
            <button
              className="btn-link give-off"
              type="button"
              disabled={!online || busy}
              onClick={turnOff}
            >
              Вимкнути посилання
            </button>
          </>
        ) : (
          <div className="give-actions">
            <button
              className="btn btn-sm"
              type="button"
              disabled={!online || busy}
              onClick={() => run(() => share.mutateAsync(listId), null)}
            >
              {busy ? "Створюємо…" : "Створити посилання"}
            </button>
          </div>
        )}
      </div>

      {/* --- у Бібліотеці --------------------------------------------------- */}

      {/* Той самий блок тієї самої будови — саме тому різницю видно. Ведене
          сюди натискання відкриває налаштування публікації: назва й опис у
          Бібліотеці свої, окремі від назви списку. */}
      <button
        className="give give-link"
        type="button"
        onClick={() => navigate(`/vocabulary/lists/${listId}/publish`)}
      >
        <span className="give-head">
          <span className="give-title">У Бібліотеці</span>
          <span className={listed ? "pill pill-on" : "pill"}>
            {listed ? "на витрині" : "не виставлено"}
          </span>
        </span>
        <span className="give-what">
          Бачать усі. Хто візьме — може поставити зірки.
        </span>

        {/* Числа є лише тоді, коли відповідь дійшла. Без неї рядок просто не
            малюється: порожнє місце нічого не стверджує, а «0 взять» офлайн
            стверджувало б неправду. */}
        {current && current.is_listed ? (
          <span className="give-figures">
            <span className="give-figure">{words(current.cards_count)}</span>
            {current.rating !== null ? (
              <span className="give-figure give-rating">
                <span className="pub-star">★</span>
                {current.rating.toFixed(1)}
                <span className="pub-of">({current.ratings_count})</span>
              </span>
            ) : null}
            <span className="give-figure">взяли {current.takes_count}</span>
          </span>
        ) : null}

        <span className="give-by">
          {current && current.is_listed
            ? asOfLine(current.content_updated_at)
            : listed
              ? "Відкрити налаштування"
              : "Налаштувати й виставити"}
          <span className="give-chevron">›</span>
        </span>
      </button>

      {!online ? (
        <div className="hint">Віддати список можна тільки зі звʼязком.</div>
      ) : null}
    </Screen>
  );
}
