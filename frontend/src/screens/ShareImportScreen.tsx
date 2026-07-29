/**
 * Чужий список за посиланням — половина отримувача.
 *
 * Головне, що екран мусить зробити правильно, — сказати правду про наслідок.
 * Імпорт **пропускає** слова, які в тебе вже є (ADR-0005), тож зі списку на 50
 * слів може додатись 38, а може й нуль. Якщо не сказати цього до натискання,
 * імпорт виглядатиме зламаним, а не вибірковим.
 *
 * Маршрут живе ПОЗА `RequireAuth`: анонімний відвідувач мусить спершу записати
 * токен, а вже потім поїхати на вхід, — інакше посилання губиться назавжди, і
 * після реєстрації з листом активації людина опиняється на «Сьогодні» з
 * порожнім словником, не знаючи, куди подівся список, за яким вона прийшла.
 */

import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, OfflineError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useOnline } from "../app/useOnline";
import { Message, Screen } from "../ui/parts";
import { forgetShare, rememberShare } from "../sharing/pending";
import { useImportShare, useSharePreview, useSharedCards } from "../sharing/queries";
import {
  alreadyHave,
  importFoundNothing,
  importSummary,
  needsMode,
  overwriteWarning,
  ownerLine,
  previewHeadline,
  previewNote,
} from "../sharing/share";
import { plural, words } from "../ui/plural";
import type { ImportMode, ImportResult, SharedCard } from "../api/sharing";

/** Переклади чужої картки в один рядок — того самого виду, що в словнику. */
function sharedSummary(card: SharedCard): string {
  return card.senses
    .map((sense) => sense.translation?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function SharedRow({ card }: { card: SharedCard }) {
  const summary = sharedSummary(card);
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

export default function ShareImportScreen() {
  const { status } = useAuth();
  const params = useParams();
  const token = params.token ?? "";

  /*
   * Запис робиться синхронно в тілі рендера, а не в ефекті, і це навмисно: у
   * тому самому кадрі повертається <Navigate>, а ефекти цього коміту можуть
   * виконатись уже після того, як навігація почалась. Повторний запис у
   * StrictMode нічого не псує — значення те саме.
   */
  if (status === "anonymous" && token) rememberShare(token);

  if (status === "loading") return <div className="screen" aria-busy="true" />;
  if (status === "anonymous") {
    return <Navigate to="/accounts/login" replace />;
  }
  if (!token) return <Navigate to="/" replace />;

  return <SharedList token={token} />;
}

function SharedList({ token }: { token: string }) {
  const navigate = useNavigate();
  const online = useOnline();

  /*
   * Доїхали — слід більше не потрібен. Забирає саме цей екран, а не вхід: доки
   * людина не побачила список, запис мусить жити, бо після реєстрації її ще
   * чекає лист активації і другий вхід.
   */
  useEffect(() => {
    forgetShare();
  }, [token]);

  const preview = useSharePreview(token);
  const cards = useSharedCards(token);
  const take = useImportShare(token);

  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [mode, setMode] = useState<ImportMode>("skip");
  const [problem, setProblem] = useState<string | null>(null);
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  /** 409 own_share / list_exists кажуть, який список уже твій, — веземо туди. */
  const [existingListId, setExistingListId] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Назву підставляє сервер (`suggested_name` уникає збігу з наявними), але
  // тільки доки людина не почала правити її сама.
  useEffect(() => {
    if (preview.data && !nameTouched) setName(preview.data.suggested_name);
  }, [preview.data, nameTouched]);

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

  const home = () => navigate("/vocabulary", { replace: true });

  /* --- посилання не працює ------------------------------------------------ */

  if (preview.isError) {
    const error = preview.error;
    const message =
      error instanceof OfflineError
        ? "Немає звʼязку. Щоб узяти список, потрібна мережа."
        : error instanceof ApiError && error.code === "share_disabled"
          ? "Власник вимкнув це посилання. Попросіть у нього нове."
          : error instanceof ApiError && error.status === 404
            ? "Посилання не працює. Можливо, воно скопійоване не повністю."
            : error instanceof Error
              ? error.message
              : "Щось пішло не так";

    return (
      <Screen back={home} title="Список недоступний">
        <Message kind="error">{message}</Message>
        <button className="btn-quiet" type="button" onClick={home}>
          До свого словника
        </button>
      </Screen>
    );
  }

  if (!preview.data) {
    return <Screen back={home}>Завантаження…</Screen>;
  }

  const summary = preview.data;
  const already = alreadyHave(summary);
  const author = ownerLine(summary.owner_name);

  /* --- звіт --------------------------------------------------------------- */

  if (result) {
    const nothing = importFoundNothing(result);
    return (
      <Screen back={home} title={nothing ? "Нічого нового" : "Взято"}>
        <p className="hint" style={{ marginTop: 10 }}>
          {nothing
            ? "Усі слова з цього списку у вас уже були, тож новий список не створювався — порожня мітка у словнику ні до чого."
            : importSummary(result)}
        </p>

        {nothing ? null : (
          <button
            className="btn"
            type="button"
            onClick={() =>
              // Фільтр словника не адресується посиланням, тож id їде станом
              // навігації — так само, як активний список у аркуш картки.
              navigate("/vocabulary", {
                replace: true,
                state: { listId: result.list_id },
              })
            }
          >
            Відкрити «{result.name}»
          </button>
        )}
        <button className="btn-quiet" type="button" onClick={home}>
          До всього словника
        </button>
      </Screen>
    );
  }

  /* --- перегляд і кнопка -------------------------------------------------- */

  const items = cards.data?.pages.flatMap((page) => page.items) ?? [];
  const canTake = online && summary.total_cards > 0 && Boolean(name.trim());

  const run = async () => {
    setProblem(null);
    setNameProblem(null);
    setExistingListId(null);

    if (mode === "overwrite" && !window.confirm(overwriteWarning(already))) return;

    try {
      setResult(await take.mutateAsync({ name: name.trim(), mode }));
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setProblem("Немає звʼязку. Спробуйте, коли зʼявиться мережа.");
      } else if (caught instanceof ApiError && caught.code === "list_exists") {
        setNameProblem("Список із такою назвою у вас уже є. Виберіть іншу.");
        setExistingListId(caught.number("list_id"));
      } else if (caught instanceof ApiError && caught.code === "own_share") {
        setProblem("Це ваш власний список — брати його в себе нема сенсу.");
        setExistingListId(caught.number("list_id"));
      } else {
        setProblem(caught instanceof Error ? caught.message : "Не вдалось узяти");
      }
    }
  };

  return (
    <Screen
      back={home}
      title={summary.list_name}
      /* Дія прибита: під нею лежить увесь список слів, і до кнопки, що стояла
         посеред нього, доводилось вертатись угору. */
      foot={
        <button
          className="btn"
          type="button"
          disabled={!canTake || take.isPending}
          onClick={run}
        >
          {take.isPending ? "Беремо…" : "Взяти список"}
        </button>
      }
    >
      {author ? <div className="sh-author">{author}</div> : null}

      <div className="sh-headline">{previewHeadline(summary)}</div>
      {previewNote(summary) ? (
        <p className="hint">{previewNote(summary)}</p>
      ) : null}

      {problem ? <Message kind="error">{problem}</Message> : null}

      <div className="ed-label">Назва у вашому словнику</div>
      <div className="ed-inline">
        <input
          value={name}
          placeholder="назва списку"
          disabled={!online}
          onChange={(event) => {
            setNameTouched(true);
            setName(event.target.value);
            setNameProblem(null);
          }}
        />
      </div>
      {nameProblem ? <div className="msg msg-error">{nameProblem}</div> : null}

      {existingListId !== null ? (
        <button
          className="btn-quiet"
          type="button"
          onClick={() =>
            navigate("/vocabulary", {
              replace: true,
              state: { listId: existingListId },
            })
          }
        >
          Відкрити той список
        </button>
      ) : null}

      {/* Перемикач з'являється лише коли збіги є: без них `skip` і `overwrite`
          роблять те саме, і кнопка «Замінити» була б органом без наслідку. */}
      {needsMode(summary) ? (
        <>
          <div className="ed-label">Слова, які у вас уже є</div>
          <div className="ed-chips">
            <button
              className={mode === "skip" ? "chip chip-on" : "chip"}
              type="button"
              onClick={() => setMode("skip")}
            >
              Пропустити
            </button>
            <button
              className={mode === "overwrite" ? "chip chip-on" : "chip"}
              type="button"
              onClick={() => setMode("overwrite")}
            >
              Замінити вмістом зі списку
            </button>
          </div>
          <p className="hint">
            {mode === "skip"
              ? `${words(already)} ${plural(already, "лишиться", "лишаться", "лишаться")} як є, і в новий список не ${plural(already, "потрапить", "потраплять", "потраплять")}.`
              : "Вміст ваших карток буде замінено: значення, приклади, форми, коментар. Прогрес повторень залишиться."}
          </p>
        </>
      ) : null}

      {!online ? (
        <div className="hint">Щоб узяти список, потрібен звʼязок.</div>
      ) : null}

      <div className="ed-label">Слова у списку</div>
      {items.map((card, index) => (
        <SharedRow card={card} key={`${card.word}#${index}`} />
      ))}
      {cards.isPending ? <div className="hint">Завантаження…</div> : null}
      <div ref={sentinel} />
      {cards.isFetchingNextPage ? <div className="hint">Ще…</div> : null}
    </Screen>
  );
}
