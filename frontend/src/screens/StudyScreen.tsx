/**
 * Навчання — повноекранний режим, а не вкладка.
 *
 * Панель вкладок сюди не приходить навмисно: палець не має вилітати з навчання
 * повз кнопку оцінки. Вийти можна лише хрестиком.
 *
 * Речі, які тут вирішено свідомо:
 *
 * 1. Скільки часу до наступного показу — не показується ніде (ADR-0009). Ні на
 *    кнопках оцінок, ні після відповіді.
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
 * 6. Картка форм і картка перекладу відрізняються будовою лиця, а не підписом:
 *    у форм це аркуш у лінійку, який розкриття заповнює. Див. `buildFaces`.
 * 7. Виправити картку можна не виходячи з навчання, але аркушем ПОВЕРХ екрана,
 *    а не переходом. Перехід розмонтував би цей компонент, і разом із ним
 *    поїхали б зерно сесії, розкритість і свіжість буфера — три латки замість
 *    одного рішення.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PencilIcon, Screen } from "../ui/parts";
import { useOnline } from "../app/useOnline";
import { cardSide, progressValue, type QueueItem, type Rating } from "../study/session";
import { useSettings, useStudy, useToday } from "../study/queries";
import { answer, beginSession, init } from "../study/store";
import { temperature } from "../study/temperature";
import { distinctTranscriptions } from "../vocabulary/card";
import { CardBody, Headword, headwordClass } from "../vocabulary/CardFace";
import CardEditSheet from "../vocabulary/CardEditSheet";
import { SpeakButton, useTts } from "../tts/SpeakButton";
import { autoplayText, stopSpeaking } from "../tts/speech";

const RATINGS: { value: Rating; label: string }[] = [
  { value: 1, label: "Не згадав" },
  { value: 2, label: "Важко" },
  { value: 3, label: "Добре" },
  { value: 4, label: "Легко" },
];

function buildFaces({
  item,
  side,
  revealed,
}: {
  item: QueueItem;
  side: "en_uk" | "uk_en";
  revealed: boolean;
}) {
  const card = item.card;
  const transcriptions = distinctTranscriptions(card);

  if (item.kind === "forms") {
    const summary = card.senses
      .map((sense) => sense.translation)
      .filter(Boolean)
      .join(", ");

    return {
      front: (
        <>
          <div className="dirhint">форми</div>
          <Headword word={card.word} className={headwordClass(card.word)} />
          {/* Робочий аркуш у лінійку — і це весь знак доріжки форм.
              Розрізняти вправи доводиться формою, а не кольором: насичений
              колір означає температуру й тільки її (ADR-0012), а на закритій
              картці його взагалі немає (ADR-0016). Пігулка «ФОРМИ» стояла в
              тому самому місці й тим самим кеглем, що «АНГЛ → УКР», тобто
              відрізнялась лише словом — а слово треба прочитати. Порожні
              рядки видно до читання.

              Рядки ті самі, що потім показують відповідь: розкриття не
              дописує другий блок під першим, а вписує форми в ці ж лінійки.
              Тому мітка стоїть у своїй колонці вже зараз і нікуди не
              стрибає. */}
          <div className="fd">
            {card.forms.map((form) => (
              <div className="fd-row" key={form.id}>
                <span className="fd-lbl">{form.label ?? "форма"}</span>
                {revealed ? (
                  <>
                    <span className="fd-form">{form.value}</span>
                    {form.transcription ? (
                      <span className="fd-ipa">{form.transcription}</span>
                    ) : null}
                    {/* Вправа тут — саме вимова форми, тож динамік на кожному
                        рядку. Автоматично вони не звучать: три висловлювання
                        поспіль відстають від пальця, що вже тягнеться до
                        оцінки. */}
                    <SpeakButton text={form.value} className="spk-end" />
                  </>
                ) : (
                  <span className="fd-blank" />
                )}
              </div>
            ))}
          </div>
        </>
      ),
      // Саме `null`, а не порожній фрагмент: фрагмент істинний навіть без
      // дітей, і екран намалював би роздільник над порожнечею. У картки форм
      // це звичайний стан — відповідь уже стоїть у лінійках лиця.
      back:
        summary || card.comment ? (
          <>
            {summary ? (
              <div className="fd-tr">
                <span className="fdt-lbl">значення</span>
                {summary}
              </div>
            ) : null}
            {card.comment ? <div className="cmt">{card.comment}</div> : null}
          </>
        ) : null,
    };
  }

  if (side === "uk_en") {
    return {
      front: (
        <>
          <div className="dirhint">укр → англ</div>
          <div className="rev-list">
            {/* Частини мови тут немає навмисно: питання поставлене рідною
                мовою, і що «храм» — іменник, людина знає без підказки. Мітка
                лишається там, де вона щось додає, — у деталях значення на
                розкритій картці. */}
            {card.senses.map((sense) => (
              <div className="rev-item" key={sense.id}>
                {sense.translation ?? "—"}
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

  /** Id картки, яку зараз правлять аркушем поверх навчання. */
  const [editing, setEditing] = useState<number | null>(null);

  /** Момент показу картки. Від нього рахується review_duration. */
  const shownAt = useRef<number>(Date.now());

  /**
   * Чи правили цю картку, поки вона висіла на екрані.
   *
   * Живе окремо від `editing`, бо потрібне вже ПІСЛЯ закриття аркуша: воно
   * вирішує, чи надсилати тривалість обдумування (ADR-0024). Скидається разом
   * зі зміною картки.
   */
  const editedWhileShown = useRef(false);

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
    editedWhileShown.current = false;
  }, [trackId]);

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
    () => (item ? buildFaces({ item, side, revealed }) : null),
    [item, side, revealed, tts.enabled],
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
    // Картку правили просто зараз — тривалості немає (ADR-0024). Число
    // вимірювало б набір тексту, а не згадування, і оптимізатор FSRS учився б
    // на вигадці. `null` каже «не міряно» чесно, нуль сказав би «згадав миттєво».
    const duration = editedWhileShown.current ? null : Date.now() - shownAt.current;
    void answer(item.track_id, rating, duration);
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
          {/* Правка зʼявляється разом із відповіддю, і тільки з нею: до
              перевороту тут немає чого виправляти, бо картки ще не видно.
              Кут панелі, а не верхня смуга екрана: дія над КАРТКОЮ, а не над
              навчанням. Офлайн її немає зовсім — вимкнений олівець на екрані,
              який офлайн працює повністю (ADR-0007), читався б як поламаний. */}
          {revealed && online ? (
            <button
              className="card-edit"
              type="button"
              aria-label="Виправити картку"
              onClick={() => setEditing(item.card.id)}
            >
              <PencilIcon />
            </button>
          ) : null}

          <div
            className="front"
            role={revealed ? undefined : "button"}
            tabIndex={revealed ? undefined : 0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setRevealedFor(item.track_id);
            }}
          >
            {faces?.front}
          </div>
          {/* Порожній `back` не малюється: у картки форм відповідь уже вписана
              в лінійки лиця, і смуга-роздільник над порожнечею читалась би як
              обрізаний вміст. */}
          {revealed && faces?.back ? <div className="back">{faces.back}</div> : null}
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

      {editing !== null ? (
        <CardEditSheet
          cardId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            editedWhileShown.current = true;
            setEditing(null);
          }}
          onDeleted={() => {
            // Оцінки тут немає навмисно: людина не відповідала на картку, вона
            // її прибрала. Доріжка йде з буфера, показується наступна.
            editedWhileShown.current = false;
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}
