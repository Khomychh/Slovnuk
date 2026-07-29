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
 * 4. Озвучення звучить саме рівно тоді, коли англійське слово вперше видно, —
 *    правило живе в `autoplayText` і накрите тестами. Форми самі не звучать
 *    ніколи: кожна має власний динамік на своєму рядку.
 * 5. «Розкрито» тримається як id доріжки, а не як прапорець. Прапорець мусив би
 *    скидатись ефектом і тому на одну мить брехав би про нову картку — див.
 *    коментар біля `revealedFor`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Screen } from "../ui/parts";
import { useOnline } from "../app/useOnline";
import { nextShowLabel, secondsUntil } from "../study/format";
import { cardSide, progressValue, type QueueItem, type Rating } from "../study/session";
import { useSettings, useStudy, useToday } from "../study/queries";
import { answer, beginSession, init } from "../study/store";
import { temperature } from "../study/temperature";
import { distinctTranscriptions } from "../vocabulary/card";
import {
  CardBody,
  Headword,
  POS_LABEL,
  headwordClass,
} from "../vocabulary/CardFace";
import { SpeakButton, useTts } from "../tts/SpeakButton";
import { autoplayText, stopSpeaking } from "../tts/speech";

const RATINGS: { value: Rating; label: string }[] = [
  { value: 1, label: "Не згадав" },
  { value: 2, label: "Важко" },
  { value: 3, label: "Добре" },
  { value: 4, label: "Легко" },
];

/** Скільки підпис інтервалу тримається на екрані. */
const LABEL_MS = 2600;

function buildFaces({ item, side }: { item: QueueItem; side: "en_uk" | "uk_en" }) {
  const card = item.card;
  const transcriptions = distinctTranscriptions(card);

  if (item.kind === "forms") {
    const labels = card.forms.map((form) => form.label).filter(Boolean) as string[];
    // Мітки — окремим рядком під пігулкою, а не в ній: «ФОРМИ · PAST + PP» в
    // одній пігулці робить її довгою смугою, і знак перестає читатись знаком.
    const hint = labels.length > 0 && labels.join(" · ").length <= 30
      ? labels.join(" · ")
      : null;
    const summary = card.senses
      .map((sense) => sense.translation)
      .filter(Boolean)
      .join(", ");

    return {
      front: (
        <>
          {/* Доріжка форм і доріжка перекладу — різні вправи, і на закритій
              картці це має бути видно до читання. Кольором розрізнити не можна:
              насичений колір у застосунку означає температуру й тільки її
              (ADR-0012, ADR-0016), тож знак — обведена пігулка. Та сама, що
              позначає форми в рядку словника: одне поняття, один знак. */}
          <div className="fd-badge">форми</div>
          {hint ? <div className="fd-hint">{hint}</div> : null}
          <Headword word={card.word} className={headwordClass(card.word)} />
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
                {/* Вправа тут — саме вимова форми, тож динамік на кожному
                    рядку. Автоматично вони не звучать: три висловлювання
                    поспіль відстають від пальця, що вже тягнеться до оцінки. */}
                <SpeakButton text={form.value} className="spk-end" />
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
          <div className="head-line">
            <div className="ans">{card.word}</div>
            <SpeakButton text={card.word} size="md" />
          </div>
          {transcriptions.length > 0 ? (
            <div className="ipa">{transcriptions.join("   ·   ")}</div>
          ) : null}
          <CardBody card={card} />
        </>
      ),
    };
  }

  return {
    front: (
      <>
        <div className="dirhint">англ → укр</div>
        <Headword word={card.word} className={headwordClass(card.word)} />
        {transcriptions.length === 1 ? <div className="ipa">{transcriptions[0]}</div> : null}
      </>
    ),
    back: <CardBody card={card} />,
  };
}

export default function StudyScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const study = useStudy();
  const settings = useSettings();
  const today = useToday();
  const tts = useTts();

  /**
   * Розкрита не «якась картка», а конкретна доріжка.
   *
   * Прапорцем це бути не може. Прапорець скидається ефектом, тобто вже після
   * того, як нова картка відмальована, — і між цими двома митями `revealed`
   * стверджує про неї те, що було правдою про попередню. У «укр → англ» це
   * означало, що автоозвучення промовляло англійське слово над українською
   * лицьовою стороною, тобто підказувало відповідь, а back нової картки встигав
   * промайнути на екрані.
   *
   * З id доріжки такого стану не існує: інша картка — інший id — закрита за
   * визначенням, без жодного ефекту й без вікна, у якому значення застаріле.
   */
  const [revealedFor, setRevealedFor] = useState<number | null>(null);
  const [label, setLabel] = useState<{ trackId: number; seconds: number } | null>(null);

  /** Момент показу картки. Від нього рахується review_duration. */
  const shownAt = useRef<number>(Date.now());

  useEffect(() => {
    void init().then(beginSession);
  }, []);

  const item = study.buffer[0] as QueueItem | undefined;
  const trackId = item?.track_id;
  const revealed = trackId !== undefined && revealedFor === trackId;

  // Новий відлік часу на обдумування. Закривати картку тут уже нічого не треба:
  // вона закрита тим, що її id не збігається з `revealedFor`.
  useEffect(() => {
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

  // `tts.enabled` у залежностях не зайвий: обличчя картки містять динаміки, а
  // React не перемальовує підтримерево, елементи якого не змінились. Без цього
  // динаміки не з'явились би на вже показаній картці, коли налаштування
  // приїхали пізніше за неї — тобто при холодному старті одразу в навчання.
  const faces = useMemo(
    () => (item ? buildFaces({ item, side }) : null),
    [item, side, tts.enabled],
  );

  /**
   * Автоозвучення.
   *
   * Що саме сказати, вирішує `autoplayText`; тут лише момент. Спрацьовує на
   * зміні картки й на розкритті — двох подіях, у які англійське слово може
   * вперше з'явитись на екрані.
   */
  useEffect(() => {
    if (!tts.autoplay || !item) return;
    const text = autoplayText(item, side, revealed);
    if (text) void tts.say(text);
    // `tts.say` навмисно поза залежностями: він міняється разом з акцентом і
    // темпом, і тоді картка озвучувалась би повторно на зміну налаштувань.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, revealed, side, tts.autoplay]);

  // Вихід із навчання обриває голос на півслові — і правильно: продовжувати
  // говорити на екрані, якого вже немає, застосунок не має права.
  useEffect(() => stopSpeaking, []);

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
    if (revealed || trackId === undefined) return;
    if ((event.target as HTMLElement).closest("button")) return;
    setRevealedFor(trackId);
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
        {/* Сяйво зʼявляється лише на розкритій картці (ADR-0016): на закритій
            колір температури — це точна підказка відповіді, і рука тягнеться до
            «Легко» ще до того, як памʼять щось видала. Без `--temp` панель бере
            запасне значення й лишається нейтральною. */}
        <div
          className="card-panel"
          style={
            revealed
              ? ({ "--temp": temperature(item.stability) } as React.CSSProperties)
              : undefined
          }
        >
          <div
            className="front"
            role={revealed ? undefined : "button"}
            tabIndex={revealed ? undefined : 0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setRevealedFor(item.track_id);
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
