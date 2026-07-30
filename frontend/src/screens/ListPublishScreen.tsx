/**
 * Публікація списку в Бібліотеці — налаштування, які робить власник.
 *
 * Сюди приходять із «Віддати список», уже побачивши обидва способи поруч. Тому
 * пояснювати різницю між посиланням і витриною тут більше не треба — її сказав
 * попередній екран самою будовою.
 *
 * Екран раніше ніс чотири абзаци про знімок, оновлення й зняття. Тепер їх
 * немає, і жодне правило при цьому не загубилось — вони просто переїхали туди,
 * де від них є користь (ADR-0022):
 *
 * 1. Публікація — це копія на дату. Про це каже рядок «54 слова · станом на
 *    30 липня» і попередження, коли список відтоді розрісся. Абзац про це
 *    людина читала до того, як розбіжність узагалі виникала, тобто ні про що.
 * 2. «Оновити» **не скидає** рейтинг. Сказано в підтвердженні оновлення — у
 *    мить, коли автор боїться саме цього.
 * 3. Зняття — це **не видалення**, рядок і рейтинг лишаються. Сказано в
 *    підтвердженні зняття, там же, де на сусідньому екрані сказано протилежне
 *    про посилання.
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
import { asOfLine, canPublish, stalenessLine } from "../library/library";
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
      `У Бібліотеці зʼявиться список у його теперішньому стані. ` +
      `Оцінки й лічильник взять залишаться — вони не скидаються.`;
    if (!window.confirm(message)) return;
    await run(() => refresh.mutateAsync(), "Оновлено.");
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
      {error ? <Message kind="error">{error}</Message> : null}
      {note ? <Message>{note}</Message> : null}

      {hiddenByModerator ? (
        <Message kind="error">
          Цю публікацію знято за скаргами. Повернути її самостійно не можна.
        </Message>
      ) : null}

      {!canPublish(list.card_count) ? (
        <div className="hint">
          У списку немає слів — виставляти нічого.
        </div>
      ) : null}

      {current ? (
        <>
          <div className="ed-label">У Бібліотеці</div>
          {/* Уся правда про копію-на-дату — цей рядок. Прийменник «станом на»
              каже те, що раніше пояснював абзац про знімок. */}
          <div className="state-line">
            {words(current.cards_count)} · {asOfLine(current.content_updated_at)}
          </div>
          <div className="state-figures">
            {current.is_listed ? null : (
              <span className="pill">знято з витрини</span>
            )}
            {current.rating !== null ? (
              <span className="state-figure">
                <span className="pub-star">★</span>
                {current.rating.toFixed(1)}
                <span className="pub-of">({current.ratings_count})</span>
              </span>
            ) : null}
            <span className="state-figure">взяли {current.takes_count}</span>
          </div>

          {/* Розбіжність показується тільки коли вона є — і тоді ж поруч стоїть
              кнопка, яка її прибирає. Мовчати про це не можна: слова, кинуті в
              опублікований список, публічними не стають самі. */}
          {staleness ? (
            <div className="state-stale">
              <span>{staleness}</span>
              {current.can_update ? (
                <button
                  className="btn-quiet btn-sm"
                  type="button"
                  disabled={!online || busy}
                  onClick={doRefresh}
                >
                  Оновити
                </button>
              ) : null}
            </div>
          ) : current.can_update ? (
            <button
              className="btn-quiet btn-sm state-update"
              type="button"
              disabled={!online || busy}
              onClick={doRefresh}
            >
              Оновити в Бібліотеці
            </button>
          ) : null}
        </>
      ) : null}

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
