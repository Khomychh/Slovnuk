/**
 * Навчання — повноекранний режим, а не вкладка.
 *
 * Панель вкладок сюди не приходить навмисно: палець не має вилітати з навчання
 * повз кнопку оцінки. Вийти можна лише хрестиком.
 *
 * Три речі, які тут вирішено свідомо:
 *
 * 1. Підпис інтервалу зʼявляється ПІСЛЯ відповіді, а не на кнопках оцінок
 *    (ADR-0009). Підпис поруч із «Легко · 3 місяці» перетворює чесну оцінку на
 *    вибір винагороди, і FSRS псується від цього тихо.
 * 2. Тап будь-де розкриває відповідь; після розкриття екран глухий. Оцінка
 *    ставиться лише кнопкою: `review_log` незворотний, і випадковий дотик, що
 *    записав би «Добре», не відкотити нічим.
 * 3. Колір оцінок — зупинки рампи сяйва, а не семафор (ADR-0012). «Не згадав»
 *    крижаний, а не червоний: забути слово не є провиною.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Screen } from "../ui/parts";
import { useOnline } from "../app/useOnline";
import { nextShowLabel, secondsUntil } from "../study/format";
import { cardSide, progressValue, type QueueItem, type Rating } from "../study/session";
import { useSettings, useStudy, useToday } from "../study/queries";
import { answer, beginSession, init } from "../study/store";

const RATINGS: { value: Rating; label: string }[] = [
  { value: 1, label: "Не згадав" },
  { value: 2, label: "Важко" },
  { value: 3, label: "Добре" },
  { value: 4, label: "Легко" },
];

const POS_LABEL: Record<string, string> = {
  n: "ім.",
  v: "дієсл.",
  adj: "прикм.",
  adv: "присл.",
  prep: "прийм.",
  phr: "фраза",
  other: "інше",
};

/**
 * Колір сяйва над карткою.
 *
 * Це стан доріжки, а не стабільність: стабільності в черзі немає — `preview`
 * і `state` це все, що приїжджає. Тому холодний кінець тут означає «щойно
 * почали», а не «шість днів», і претендувати на точність смуги «Прогресу» він
 * не може.
 */
const STATE_COLOR: Record<string, string> = {
  new: "var(--a0)",
  learning: "var(--a1)",
  relearning: "var(--a1)",
  review: "var(--a3)",
};

/** Скільки підпис інтервалу тримається на екрані. */
const LABEL_MS = 2600;

/** Кегль слова: 61-символьні «слова» в словнику є, і вони цілі речення. */
function headwordClass(word: string): string {
  if (word.length > 34) return "headword tiny";
  if (word.length > 16) return "headword small";
  return "headword";
}

/** Різні транскрипції картки: коли вона одна, її показують спільним рядком. */
function distinctTranscriptions(card: QueueItem["card"]): string[] {
  const seen: string[] = [];
  for (const sense of card.senses) {
    const value = sense.transcription?.trim();
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

function Examples({ examples }: { examples: QueueItem["card"]["senses"][number]["examples"] }) {
  if (examples.length === 0) return null;
  return (
    <div className="ex">
      {examples.map((example) => (
        <p key={example.id}>
          {example.text_en}
          {example.text_uk ? <span className="ex-tr">{example.text_uk}</span> : null}
        </p>
      ))}
    </div>
  );
}

function Forms({ forms }: { forms: QueueItem["card"]["forms"] }) {
  if (forms.length === 0) return null;
  return (
    <div className="forms">
      <div className="forms-h">Форми</div>
      {forms.map((form) => (
        <div className="frow" key={form.id}>
          <span className="flbl">{form.label ?? "форма"}</span>
          <span>{form.value}</span>
          {form.transcription ? <span className="fipa">{form.transcription}</span> : null}
        </div>
      ))}
    </div>
  );
}

function SenseBlocks({ card }: { card: QueueItem["card"] }) {
  const transcriptions = distinctTranscriptions(card);
  return (
    <>
      {card.senses.map((sense) => (
        <div className="sense-ans" key={sense.id}>
          {sense.part_of_speech ? (
            <span className="pos-tag">{POS_LABEL[sense.part_of_speech]}</span>
          ) : null}
          <span className="s-tr-big">{sense.translation ?? "—"}</span>
          {/* Транскрипція біля значення потрібна лише коли вони різні: інакше
              вона вже стоїть спільним рядком угорі. */}
          {sense.transcription && transcriptions.length > 1 ? (
            <span className="s-ipa-tag">{sense.transcription}</span>
          ) : null}
          <Examples examples={sense.examples} />
        </div>
      ))}
    </>
  );
}

function buildFaces({ item, side }: { item: QueueItem; side: "en_uk" | "uk_en" }) {
  const card = item.card;
  const transcriptions = distinctTranscriptions(card);

  if (item.kind === "forms") {
    const labels = card.forms.map((form) => form.label).filter(Boolean) as string[];
    const hint =
      labels.length > 0 && labels.join(" + ").length <= 26
        ? `згадай форми · ${labels.join(" + ")}`
        : "згадай форми слова";
    const summary = card.senses
      .map((sense) => sense.translation)
      .filter(Boolean)
      .join(", ");

    return {
      front: (
        <>
          <div className="fd-hint">{hint}</div>
          <div className={headwordClass(card.word)}>{card.word}</div>
        </>
      ),
      back: (
        <>
          <div className="fd">
            {card.forms.map((form) => (
              <div className="fd-row" key={form.id}>
                <span className="fd-lbl">{form.label ?? "форма"}</span>
                <span className="fd-form">{form.value}</span>
                {form.transcription ? (
                  <span className="fd-ipa">{form.transcription}</span>
                ) : null}
              </div>
            ))}
          </div>
          {summary ? (
            <div className="fd-tr">
              <span className="fdt-lbl">значення</span>
              {summary}
            </div>
          ) : null}
          {card.comment ? <div className="cmt">{card.comment}</div> : null}
        </>
      ),
    };
  }

  if (side === "uk_en") {
    return {
      front: (
        <>
          <div className="dirhint">укр → англ</div>
          <div className="rev-list">
            {card.senses.map((sense) => (
              <div className="rev-item" key={sense.id}>
                {sense.translation ?? "—"}
                {sense.part_of_speech ? (
                  <span className="rev-meta"> {POS_LABEL[sense.part_of_speech]}</span>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ),
      back: (
        <>
          <div className="ans">{card.word}</div>
          {transcriptions.length > 0 ? (
            <div className="ipa">{transcriptions.join("   ·   ")}</div>
          ) : null}
          <SenseBlocks card={card} />
          <Forms forms={card.forms} />
          {card.comment ? <div className="cmt">{card.comment}</div> : null}
        </>
      ),
    };
  }

  return {
    front: (
      <>
        <div className="dirhint">англ → укр</div>
        <div className={headwordClass(card.word)}>{card.word}</div>
        {transcriptions.length === 1 ? <div className="ipa">{transcriptions[0]}</div> : null}
      </>
    ),
    back: (
      <>
        <SenseBlocks card={card} />
        <Forms forms={card.forms} />
        {card.comment ? <div className="cmt">{card.comment}</div> : null}
      </>
    ),
  };
}

export default function StudyScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const study = useStudy();
  const settings = useSettings();
  const today = useToday();

  const [revealed, setRevealed] = useState(false);
  const [label, setLabel] = useState<{ trackId: number; seconds: number } | null>(null);

  /** Момент показу картки. Від нього рахується review_duration. */
  const shownAt = useRef<number>(Date.now());

  useEffect(() => {
    void init().then(beginSession);
  }, []);

  const item = study.buffer[0] as QueueItem | undefined;
  const trackId = item?.track_id;

  // Нова картка — знову закрита відповідь і новий відлік часу на обдумування.
  useEffect(() => {
    setRevealed(false);
    shownAt.current = Date.now();
  }, [trackId]);

  // Підпис зникає сам: він інформує, а не вимагає дії.
  useEffect(() => {
    if (!label) return;
    const timer = setTimeout(() => setLabel(null), LABEL_MS);
    return () => clearTimeout(timer);
  }, [label]);

  // Відповідь доїхала до сервера — уточнюємо підпис фактом замість прогнозу.
  useEffect(() => {
    const fact = study.lastReview;
    if (!fact || !label || fact.trackId !== label.trackId) return;
    setLabel({ trackId: fact.trackId, seconds: secondsUntil(fact.dueAt) });
    // label навмисно не в залежностях: інакше уточнення саме себе перезапускало б.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [study.lastReview]);

  const side = useMemo(
    () =>
      item ? cardSide(item, settings.data?.study_direction ?? "en_uk", study.seed) : "en_uk",
    [item, settings.data?.study_direction, study.seed],
  );

  const faces = useMemo(() => (item ? buildFaces({ item, side }) : null), [item, side]);

  const rate = (rating: Rating) => {
    if (!item) return;
    const preview = item.preview;
    const seconds =
      rating === 1
        ? preview.again
        : rating === 2
          ? preview.hard
          : rating === 3
            ? preview.good
            : preview.easy;

    // Прогноз показуємо миттєво — чекати круга до сервера не треба, а офлайн
    // його й не буде. Факт приїде пізніше і замінить це число.
    setLabel({ trackId: item.track_id, seconds });
    void answer(item.track_id, rating, Date.now() - shownAt.current);
  };

  const reviewGoal = (today.data ?? study.snapshotToday)?.review_goal ?? 0;
  const done = progressValue(study.progress);
  const goalMet = reviewGoal > 0 && done >= reviewGoal;
  const percent = reviewGoal > 0 ? Math.min(100, Math.round((done / reviewGoal) * 100)) : 0;

  /**
   * Тап по будь-якому місцю розкриває відповідь.
   *
   * Кнопки виключені навмисно: хрестик мусить закривати, а не перевертати. Після
   * розкриття обробник не робить нічого — оцінку ставить лише кнопка оцінки.
   */
  const revealOnTap = (event: React.MouseEvent<HTMLDivElement>) => {
    if (revealed) return;
    if ((event.target as HTMLElement).closest("button")) return;
    setRevealed(true);
  };

  const topBar = (
    <div className="study-top">
      <button
        className="study-close"
        type="button"
        aria-label="Вийти з навчання"
        onClick={() => navigate("/")}
      >
        ×
      </button>
      {/* Смужка — рух до денної цілі, а не «скільки лишилось»: черга
          поповнюється сама, і спадного числа не існує. */}
      <div className="study-bar">
        <i className={goalMet ? "met" : ""} style={{ width: `${percent}%` }} />
      </div>
      <span className="study-count">
        {reviewGoal > 0 ? `${done} / ${reviewGoal}` : done}
      </span>
    </div>
  );

  if (!study.ready) {
    return <div className="study" aria-busy="true" />;
  }

  if (!item) {
    return (
      <div className="study">
        {topBar}
        <Screen>
          <div className="done">
            <div className="done-big">
              {study.refilling ? "Завантажую…" : "Все повторено"}
            </div>
            <p className="hint hint-center">
              {online
                ? "Черга порожня. Забуті слова повернуться сьогодні ж."
                : "Збережені картки скінчились. Решта завантажиться, щойно буде звʼязок."}
            </p>
            <button className="btn" type="button" onClick={() => navigate("/")}>
              До «Сьогодні»
            </button>
          </div>
        </Screen>
      </div>
    );
  }

  return (
    <div className="study" onClick={revealOnTap}>
      {topBar}

      <div className="study-note" role="status">
        {label ? nextShowLabel(label.seconds) : " "}
      </div>

      <div className="study-scroll">
        <div
          className="card-panel"
          style={{ "--temp": STATE_COLOR[item.state] ?? "var(--a1)" } as React.CSSProperties}
        >
          <div
            className="front"
            role={revealed ? undefined : "button"}
            tabIndex={revealed ? undefined : 0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setRevealed(true);
            }}
          >
            {faces?.front}
            {revealed ? null : (
              <div className="tap-hint">торкнись будь-де, щоб побачити відповідь</div>
            )}
          </div>
          {revealed ? <div className="back">{faces?.back}</div> : null}
        </div>
      </div>

      <div className="study-actions">
        {revealed ? (
          <div className="rate">
            {RATINGS.map((rating) => (
              <button
                key={rating.value}
                type="button"
                data-r={rating.value}
                onClick={() => rate(rating.value)}
              >
                {rating.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
