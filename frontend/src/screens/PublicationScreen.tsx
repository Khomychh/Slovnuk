/**
 * Сторінка публікації — половина читача.
 *
 * Головне, що екран мусить зробити правильно, — сказати правду про наслідок.
 * Взяття **пропускає** слова, які в тебе вже є (ADR-0005), тож зі списку на 540
 * слів може додатись 495, а може й нуль. Не сказавши цього до натискання, кнопка
 * виглядає зламаною, а не вибірковою. І після натискання пропущені слова
 * НАЗИВАЮТЬСЯ: неповнота, про яку не сказали, читається як загублені слова.
 *
 * Сам екран — чистий перегляд: що це за список і які в ньому слова. Поле «назва
 * у вашому словнику» звідси прибрано в аркуш, що підіймається після натискання
 * (ADR-0022): доти воно змушувало заповнювати форму списку, який людина ще не
 * вирішила брати, і стояло посеред екрана, розриваючи слова навпіл.
 *
 * Перемикача «замінити мої картки» тут немає й не буде: у шері він доречний, бо
 * ти знаєш, від кого береш, а тут на іншому кінці незнайомець.
 *
 * Зірки доступні лише тому, хто взяв, — і лишаються доступними після того, як він
 * видалив узятий список: він справді брав, і право сказати про це не зникає з
 * прибиранням у себе.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, OfflineError } from "../api/client";
import { useOnline } from "../app/useOnline";
import { Message, Screen } from "../ui/parts";
import {
  usePublication,
  usePublicationCards,
  useRatePublication,
  useReportPublication,
  useTakePublication,
} from "../library/queries";
import {
  authorLine,
  derivedLine,
  REPORT_REASONS,
  skippedPreview,
  takeFoundNothing,
  takeHeadline,
  takeNote,
  takeSummary,
  updatedLine,
} from "../library/library";
import { words } from "../ui/plural";
import type { ReportReason, SnapshotCard, TakeResult } from "../api/library";

/** Переклади картки в один рядок — того самого виду, що у словнику й у шері. */
function cardSummary(card: SnapshotCard): string {
  return card.senses
    .map((sense) => sense.translation?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function CardRow({ card }: { card: SnapshotCard }) {
  const summary = cardSummary(card);
  return (
    <div className={card.already_have ? "sh-row sh-row-have" : "sh-row"}>
      <div className="sh-word-line">
        <span className="sh-word">{card.word}</span>
        {card.forms.length > 0 ? <span className="v-tag">форми</span> : null}
        {card.already_have ? <span className="sh-have">вже є</span> : null}
      </div>
      {summary ? <div className="sh-tr">{summary}</div> : null}
    </div>
  );
}

/**
 * П'ять зірок.
 *
 * Кнопки, а не радіо: набір фіксований і малий, а натискання мусить одразу
 * надсилати оцінку — окремої кнопки «зберегти зірки» тут немає, бо оцінка є
 * однією дією, а не формою.
 */
function Stars({
  value,
  disabled,
  onPick,
}: {
  value: number | null;
  disabled: boolean;
  onPick: (stars: number) => void;
}) {
  return (
    <div className="lib-stars" role="group" aria-label="Ваша оцінка">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          className={value !== null && star <= value ? "lib-star on" : "lib-star"}
          type="button"
          disabled={disabled}
          aria-label={`${star} з 5`}
          aria-pressed={value === star}
          onClick={() => onPick(star)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function PublicationScreen() {
  const params = useParams();
  const id = Number(params.id);
  const navigate = useNavigate();
  const online = useOnline();

  const publication = usePublication(Number.isFinite(id) ? id : undefined);
  const cards = usePublicationCards(Number.isFinite(id) ? id : undefined);
  const take = useTakePublication(id);
  const rate = useRatePublication(id);
  const report = useReportPublication(id);

  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [taking, setTaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [existingListId, setExistingListId] = useState<number | null>(null);
  const [result, setResult] = useState<TakeResult | null>(null);
  const [reporting, setReporting] = useState(false);

  // Назву підставляє сервер (`suggested_name` уникає збігу з наявними), але
  // тільки доки людина не почала правити її сама.
  useEffect(() => {
    if (publication.data && !nameTouched) setName(publication.data.suggested_name);
  }, [publication.data, nameTouched]);

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

  // Витрина власного кореня не має — це половина «Списків» (ADR-0021).
  const back = () => navigate("/vocabulary/lists", { state: { half: "library" } });

  /* --- публікація недоступна ---------------------------------------------- */

  if (publication.isError) {
    const error = publication.error;
    const message =
      error instanceof OfflineError
        ? "Немає звʼязку. Бібліотека живе в мережі."
        : error instanceof ApiError && error.code === "publication_unlisted"
          ? "Автор зняв цей список із Бібліотеки."
          : error instanceof ApiError && error.status === 404
            ? "Такої публікації немає."
            : error instanceof Error
              ? error.message
              : "Щось пішло не так";

    return (
      <Screen back={back} title="Список недоступний">
        <Message kind="error">{message}</Message>
        <button className="btn-quiet" type="button" onClick={back}>
          До Бібліотеки
        </button>
      </Screen>
    );
  }

  if (!publication.data) {
    return <Screen back={back}>Завантаження…</Screen>;
  }

  const summary = publication.data;

  /* --- звіт після взяття -------------------------------------------------- */

  if (result) {
    const nothing = takeFoundNothing(result);
    const skipped = skippedPreview(result.skipped_words);

    return (
      <Screen back={back} title={nothing ? "Нічого нового" : "Взято"}>
        <p className="hint" style={{ marginTop: 10 }}>
          {nothing
            ? "Усі слова з цього списку у вас уже були, тож новий список не створювався — порожня мітка у словнику ні до чого."
            : takeSummary(result)}
        </p>

        {/* Пропущені слова називаються — і тут, і в шері. Список неповний за
            визначенням, і мовчання про це читається як загублені слова. */}
        {skipped.shown.length > 0 ? (
          <>
            <div className="ed-label">
              Не додалось — {words(result.skipped_words.length)}, {" "}
              бо {result.skipped_words.length === 1 ? "воно" : "вони"} у вас уже є
            </div>
            <div className="lib-skipped">
              {skipped.shown.map((word) => (
                <span className="lib-skipped-word" key={word}>
                  {word}
                </span>
              ))}
              {skipped.rest > 0 ? (
                <span className="lib-skipped-rest">і ще {skipped.rest}</span>
              ) : null}
            </div>
            <p className="hint">
              Ваші картки не змінились — взяття їх не чіпає.
            </p>
          </>
        ) : null}

        {nothing ? null : (
          <button
            className="btn"
            type="button"
            onClick={() =>
              // Фільтр словника не адресується посиланням, тож id їде станом
              // навігації — так само, як у звіті шеру.
              navigate("/vocabulary", { state: { listId: result.list_id } })
            }
          >
            Відкрити «{result.name}»
          </button>
        )}
        <button className="btn-quiet" type="button" onClick={back}>
          До Бібліотеки
        </button>
      </Screen>
    );
  }

  /* --- перегляд і дії ----------------------------------------------------- */

  const items = cards.data?.pages.flatMap((page) => page.items) ?? [];
  const derived = derivedLine(summary.derived_from_title);
  /*
   * `new_cards > 0`, а не `cards_count > 0`: обіцянка кнопки в тому, що словник
   * поповниться. Коли всі слова вже є — а так буває і в чужому списку, і у
   * власній публікації, — натискання не додало б нічого, а для власної ще й
   * упало б у 409. Кнопка, яка веде в тупик, гірша за погашену: перша обманює,
   * друга каже правду. Причину вже сказав заголовок «Усі ці слова у вас уже є»,
   * тож підписувати її вдруге не треба.
   */
  const canOpenTake = online && summary.new_cards > 0;

  const run = async () => {
    setProblem(null);
    setNameProblem(null);
    setExistingListId(null);

    try {
      const done = await take.mutateAsync(name.trim());
      setTaking(false);
      setResult(done);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setProblem("Немає звʼязку. Спробуйте, коли зʼявиться мережа.");
      } else if (caught instanceof ApiError && caught.code === "list_exists") {
        setNameProblem("Список із такою назвою у вас уже є. Виберіть іншу.");
        setExistingListId(caught.number("list_id"));
      } else if (caught instanceof ApiError && caught.code === "own_publication") {
        setProblem("Це ваша власна публікація — брати її в себе нема сенсу.");
        setExistingListId(caught.number("list_id"));
      } else {
        setProblem(caught instanceof Error ? caught.message : "Не вдалось узяти");
      }
    }
  };

  return (
    <Screen
      back={back}
      title={summary.title}
      /* Дія прибита: під нею лежить увесь список слів, і до кнопки, що стояла
         посеред нього, доводилось вертатись угору. */
      foot={
        <button
          className="btn"
          type="button"
          disabled={!canOpenTake}
          onClick={() => {
            setProblem(null);
            setNameProblem(null);
            setTaking(true);
          }}
        >
          Взяти список
        </button>
      }
    >
      {/* Числа окремо від людей — два голоси, як на картці витрини (ADR-0022). */}
      <div className="pub-figures pub-figures-page">
        <span className="pub-figure">{words(summary.cards_count)}</span>
        {summary.rating !== null ? (
          <span className="pub-figure pub-rating">
            <span className="pub-star">★</span>
            {summary.rating.toFixed(1)}
            <span className="pub-of">({summary.ratings_count})</span>
          </span>
        ) : null}
        <span className="pub-figure">взяли {summary.takes_count}</span>
      </div>
      <div className="pub-by pub-by-page">
        {authorLine(summary.author)}
        <span className="pub-sep">·</span>
        {updatedLine(summary.content_updated_at)}
      </div>
      {derived ? <div className="pub-derived">↳ {derived}</div> : null}

      {summary.description ? (
        <p className="lib-desc-full">{summary.description}</p>
      ) : null}

      <div className="sh-headline">{takeHeadline(summary)}</div>

      {problem ? <Message kind="error">{problem}</Message> : null}

      {existingListId !== null ? (
        <button
          className="btn-quiet"
          type="button"
          onClick={() => navigate("/vocabulary", { state: { listId: existingListId } })}
        >
          Відкрити той список
        </button>
      ) : null}

      {!online ? (
        <div className="hint">Щоб узяти список, потрібен звʼязок.</div>
      ) : null}

      {/* Зірки з'являються лише в того, хто взяв: рейтинг означає «я цим
          користувався», а не «мені сподобалась назва». */}
      {summary.can_rate ? (
        <>
          <div className="ed-label">Ваша оцінка</div>
          <Stars
            value={summary.own_stars}
            disabled={!online || rate.isPending}
            onPick={(stars) => void rate.mutateAsync(stars).catch(() => {})}
          />
        </>
      ) : null}

      <div className="ed-label">Слова у списку</div>
      {items.map((card, index) => (
        <CardRow card={card} key={`${card.word}#${index}`} />
      ))}
      {cards.isPending ? <div className="hint">Завантаження…</div> : null}
      <div ref={sentinel} />
      {cards.isFetchingNextPage ? <div className="hint">Ще…</div> : null}

      {/* Скарга не вимагає взяття: на непристойний список скаржаться саме тому,
          що НЕ хочуть його брати. */}
      <div className="lib-report">
        {summary.own_report ? (
          <span className="hint">Ви поскаржились на цей список.</span>
        ) : reporting ? (
          <div className="ed-chips">
            {REPORT_REASONS.map((reason) => (
              <button
                key={reason.value}
                className="chip"
                type="button"
                disabled={!online}
                onClick={() => {
                  setReporting(false);
                  void report
                    .mutateAsync(reason.value as ReportReason)
                    .catch((caught) =>
                      setProblem(
                        caught instanceof Error
                          ? caught.message
                          : "Не вдалось надіслати скаргу",
                      ),
                    );
                }}
              >
                {reason.label}
              </button>
            ))}
            <button
              className="chip"
              type="button"
              onClick={() => setReporting(false)}
            >
              Скасувати
            </button>
          </div>
        ) : (
          <button
            className="btn-link"
            type="button"
            disabled={!online}
            onClick={() => setReporting(true)}
          >
            Поскаржитись
          </button>
        )}
      </div>

      {/* --- аркуш взяття -------------------------------------------------- */}

      {/* Назва питається саме тут, а не на екрані: доти вона була формою списку,
          який людина ще не вирішила брати. В аркуші ж усе, що впливає на
          рішення, стоїть поруч — скільки додасться, скільки пропустимо і як це
          назветься. */}
      {taking ? (
        <div className="sheet-scrim" onClick={() => setTaking(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-label="Взяти список"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-page">
              <div className="sheet-title">{takeHeadline(summary)}</div>
              {takeNote(summary) ? (
                <p className="hint">{takeNote(summary)}</p>
              ) : null}

              <div className="ed-label">Назва у вашому словнику</div>
              <div className="ed-inline">
                <input
                  value={name}
                  placeholder="назва списку"
                  autoFocus
                  disabled={!online}
                  onChange={(event) => {
                    setNameTouched(true);
                    setName(event.target.value);
                    setNameProblem(null);
                  }}
                />
              </div>
              {nameProblem ? (
                <div className="msg msg-error">{nameProblem}</div>
              ) : null}

              <button
                className="btn"
                type="button"
                disabled={!online || !name.trim() || take.isPending}
                onClick={run}
              >
                {take.isPending ? "Беремо…" : "Взяти"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Screen>
  );
}
