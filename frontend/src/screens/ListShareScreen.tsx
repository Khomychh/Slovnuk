/**
 * Спільне посилання на список — половина власника.
 *
 * Стан посилання не питається окремим запитом: `share_token` уже їде в
 * `GET /vocabulary/lists/`, і саме тому іконка в рядку «Списків» може малювати
 * «поділено» без запиту на кожен список.
 *
 * Екран мусить казати три речі, які інакше здивують: шер — це копія, а не
 * підписка; посилання безадресне, тож ним скористається будь-хто, кому воно
 * потрапило до рук; вимкнене посилання не воскресає — увімкнути знову означає
 * нове.
 */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { Message, Screen, ShareIcon } from "../ui/parts";
import { useLists } from "../vocabulary/queries";
import { useShareList, useUnshareList } from "../sharing/queries";
import { buildShareUrl } from "../sharing/share";
import { words } from "../ui/plural";

export default function ListShareScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const params = useParams();
  const listId = Number(params.id);

  const lists = useLists();
  const share = useShareList();
  const unshare = useUnshareList();

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
      <p className="hint" style={{ marginTop: 10 }}>
        {words(list.card_count)} у цьому списку.
      </p>

      {error ? <Message kind="error">{error}</Message> : null}
      {note ? <Message>{note}</Message> : null}

      {token && url ? (
        <>
          <div className="ed-label">Спільне посилання</div>
          {/* Посилання видно цілком і його можна виділити пальцем: коли буфер
              обміну недоступний, це єдиний шлях, і ховати адресу за кнопкою
              означало б робити тупик. */}
          <div className="share-url">{url}</div>

          <div className="share-actions">
            <button
              className="btn"
              type="button"
              disabled={!online}
              onClick={sendOut}
            >
              <span className="btn-with-icon">
                <ShareIcon />
                Поділитись
              </span>
            </button>
            <button className="btn-quiet" type="button" onClick={copy}>
              Копіювати
            </button>
          </div>

          <p className="hint">
            Посилання багаторазове й безадресне: ним скористається будь-хто, кому
            воно потрапить до рук. Той, хто його відкриє, отримає{" "}
            <strong>свою копію</strong> слів — ваші подальші правки до нього вже
            не дійдуть, а його правки не дійдуть до вас.
          </p>

          <button
            className="btn-quiet card-delete"
            type="button"
            disabled={!online || busy}
            onClick={turnOff}
          >
            Вимкнути посилання
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            Поки посилання немає, список бачите тільки ви. Коли створите — кожен,
            хто його відкриє, зможе взяти ці слова собі: він отримає власні
            картки з чистим графіком повторень, а не доступ до ваших.
          </p>
          <button
            className="btn"
            type="button"
            disabled={!online || busy}
            onClick={() => run(() => share.mutateAsync(listId), null)}
          >
            {busy ? "Створюємо…" : "Створити посилання"}
          </button>
        </>
      )}

      {!online ? (
        <div className="hint">Дії з посиланням потребують звʼязку.</div>
      ) : null}
    </Screen>
  );
}
