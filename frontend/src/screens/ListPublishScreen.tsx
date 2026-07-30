/**
 * Публікація списку в Бібліотеці — половина власника.
 *
 * Сестра `ListShareScreen`, і навмисно окремий екран: посилання й публікація —
 * дві різні дії з різними наслідками, і одна кнопка з перемикачем змусила б
 * людину вирішувати обидві разом.
 *
 * Екран мусить сказати три речі, які інакше здивують:
 *
 * 1. Публікація — це **знімок**. Нове слово, кинуте в опублікований список,
 *    публічним не стає, доки не натиснути «Оновити». Це не недогляд, а захист:
 *    інакше все, що ти потім кинеш у цю мітку, ставало б публічним само.
 * 2. «Оновити» **не скидає** рейтинг. Без цього автор, який виправив одну
 *    друкарську помилку, втратив би 4.6★ і більше ніколи цю кнопку не натиснув.
 * 3. Зняття — це **не видалення**. Рядок і рейтинг лишаються, і повернення
 *    відновлює їх. Тут правило шеру інвертується, і про це варто сказати вголос,
 *    бо на сусідньому екрані сказано протилежне.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, OfflineError } from "../api/client";
import { useOnline } from "../app/useOnline";
import { Message, Screen } from "../ui/parts";
import { useLists } from "../vocabulary/queries";
import {
  useListPublication,
  usePublishList,
  useRefreshPublication,
  useUnpublishList,
} from "../library/queries";
import {
  canPublish,
  ratingLine,
  stalenessLine,
  updatedLine,
} from "../library/library";
import { words } from "../ui/plural";
import { MAX_TITLE, MAX_DESCRIPTION } from "../library/limits";

export default function ListPublishScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const params = useParams();
  const listId = Number(params.id);

  const lists = useLists();
  const publication = useListPublication(Number.isFinite(listId) ? listId : undefined);
  const publish = usePublishList(listId);
  const refresh = useRefreshPublication(listId);
  const unpublish = useUnpublishList(listId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = lists.data?.items.find((item) => item.id === listId);

  /*
   * 404 від `useListPublication` — це нормальний стан «не опубліковано», а не
   * помилка. Розрізняємо саме за кодом статусу: усе інше (offline, 500) мусить
   * лишитись помилкою, інакше екран показував би форму публікації там, де
   * насправді немає звʼязку.
   */
  const notPublished =
    publication.isError &&
    publication.error instanceof ApiError &&
    publication.error.status === 404;

  const current = publication.data ?? null;

  // Назва списку — лише чернетка: «Загальний» нормальна назва для себе й
  // нікчемна на витрині. Далі публікація живе власною назвою.
  useEffect(() => {
    if (touched) return;
    if (current) {
      setTitle(current.title);
      setDescription(current.description ?? "");
    } else if (list) {
      setTitle(list.name);
    }
  }, [current, list, touched]);

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
  if (publication.isPending) {
    return <Screen back={back} title={list.name}>Завантаження…</Screen>;
  }
  if (publication.isError && !notPublished) {
    const problem = publication.error;
    return (
      <Screen back={back} title={list.name}>
        <Message kind="error">
          {problem instanceof OfflineError
            ? "Немає звʼязку. Бібліотека живе в мережі."
            : problem instanceof Error
              ? problem.message
              : "Не вдалось завантажити"}
        </Message>
      </Screen>
    );
  }

  const run = async (action: () => Promise<unknown>, done: string | null) => {
    setError(null);
    setNote(null);
    try {
      await action();
      if (done) setNote(done);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError("Немає звʼязку. Спробуйте, коли зʼявиться мережа.");
      } else if (caught instanceof ApiError && caught.code === "author_name_required") {
        setError(
          "Щоб публікувати, вкажіть імʼя та прізвище в профілі: у Бібліотеці список підписаний автором.",
        );
      } else {
        setError(caught instanceof Error ? caught.message : "Не вдалось");
      }
    }
  };

  const busy = publish.isPending || refresh.isPending || unpublish.isPending;
  const trimmed = title.trim();

  const save = () =>
    run(
      () =>
        publish.mutateAsync({
          title: trimmed,
          // Порожній опис — це саме відсутність опису, а не порожній рядок:
          // інакше на витрині був би пустий абзац під назвою.
          description: description.trim() || null,
        }),
      current ? "Збережено." : "Опубліковано.",
    );

  const takeOff = async () => {
    const message =
      `Список зникне з Бібліотеки. Ті, хто вже взяв його, свої слова залишать — ` +
      `це копія, а не підписка. Оцінки й лічильник взять НЕ зникають: ` +
      `опублікувавши знову, ви повернете їх разом із публікацією.`;
    if (!window.confirm(message)) return;
    await run(() => unpublish.mutateAsync(), "Знято з Бібліотеки.");
  };

  const doRefresh = async () => {
    const message =
      `Вміст публікації буде замінено списком у його теперішньому стані. ` +
      `Оцінки й лічильник взять залишаться, а на витрині зʼявиться нова дата ` +
      `оновлення.`;
    if (!window.confirm(message)) return;
    await run(() => refresh.mutateAsync(), "Публікацію оновлено.");
  };

  const staleness = current ? stalenessLine(current) : null;
  const hiddenByModerator = current?.hidden_by_moderator ?? false;

  return (
    <Screen
      back={back}
      title={list.name}
      foot={
        <button
          className="btn"
          type="button"
          disabled={
            !online ||
            busy ||
            !trimmed ||
            hiddenByModerator ||
            !canPublish(list.card_count)
          }
          onClick={save}
        >
          {busy
            ? "Зберігаємо…"
            : current
              ? current.is_listed
                ? "Зберегти зміни"
                : "Опублікувати знову"
              : "Опублікувати в Бібліотеці"}
        </button>
      }
    >
      <p className="hint" style={{ marginTop: 10 }}>
        {words(list.card_count)} у цьому списку.
      </p>

      {error ? <Message kind="error">{error}</Message> : null}
      {note ? <Message>{note}</Message> : null}

      {!canPublish(list.card_count) ? (
        <div className="hint">
          Порожній список публікувати нема сенсу — його знімок вийшов би порожнім.
        </div>
      ) : null}

      {hiddenByModerator ? (
        <Message kind="error">
          Цю публікацію знято за скаргами. Повернути її самостійно не можна.
        </Message>
      ) : null}

      {current ? (
        <>
          <div className="ed-label">Стан у Бібліотеці</div>
          <div className="lib-own-state">
            <div className="lib-meta">
              {current.is_listed ? "на витрині" : "знято з витрини"} ·{" "}
              {words(current.cards_count)} у знімку · взяли {current.takes_count}
            </div>
            <div className="lib-meta lib-meta-quiet">
              {ratingLine(current) ? <span>{ratingLine(current)}</span> : null}
              <span>{updatedLine(current.content_updated_at)}</span>
            </div>
          </div>

          {/* Знімок — головне, чого не вгадаєш. Тому про нього сказано тут, а не
              в кінці екрана. */}
          <p className="hint">
            У Бібліотеці лежить <strong>знімок</strong> цього списку, а не сам
            список. Слова, які ви додасте пізніше, публічними не стануть, доки ви
            не натиснете «Оновити публікацію».
          </p>

          {staleness ? <Message>{staleness}</Message> : null}

          {current.can_update ? (
            <button
              className="btn-quiet"
              type="button"
              disabled={!online || busy}
              onClick={doRefresh}
            >
              Оновити публікацію
            </button>
          ) : null}
        </>
      ) : (
        <p className="hint">
          Поки список не опубліковано, його бачите тільки ви. Опублікувавши,
          ви віддаєте в Бібліотеку <strong>знімок</strong> — копію слів на цю
          мить. Кожен, хто його візьме, отримає власні картки з чистим графіком
          повторень, а не доступ до ваших.
        </p>
      )}

      <div className="ed-label">Назва в Бібліотеці</div>
      <div className="ed-inline">
        <input
          value={title}
          placeholder="як назвати список для інших"
          maxLength={MAX_TITLE}
          disabled={!online || hiddenByModerator}
          onChange={(event) => {
            setTouched(true);
            setTitle(event.target.value);
          }}
        />
      </div>
      <p className="hint">
        Окрема від назви у вашому словнику: перейменувавши список у себе, ви не
        зміните нічого в Бібліотеці.
      </p>

      <div className="ed-label">Опис</div>
      <textarea
        className="ed-body lib-desc-input"
        value={description}
        placeholder="для кого цей список і що в ньому"
        maxLength={MAX_DESCRIPTION}
        disabled={!online || hiddenByModerator}
        onChange={(event) => {
          setTouched(true);
          setDescription(event.target.value);
        }}
      />

      {current && current.is_listed ? (
        <button
          className="btn-quiet card-delete"
          type="button"
          disabled={!online || busy}
          onClick={takeOff}
        >
          Зняти з Бібліотеки
        </button>
      ) : null}

      {!online ? (
        <div className="hint">Дії з публікацією потребують звʼязку.</div>
      ) : null}
    </Screen>
  );
}
