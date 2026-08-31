/**
 * Редактор картки — створення і правка одним екраном.
 *
 * Живе у двох рамах: як екран за маршрутом і як аркуш поверх навчання
 * (`CardEditSheet`). Через це виходи параметризовані — `onSaved`, `onDeleted`,
 * `onClose`. Другого редактора для «швидкої правки» немає навмисно: помилка в
 * картці буває в будь-якому полі, і скорочена форма ловила б рівно ті, які
 * встиг передбачити автор скорочення.
 *
 * ЕКРАН ГОВОРИТЬ ЧОТИРМА ПАНЕЛЯМИ, А НЕ ДЕСЯТЬМА. Слово, значення, форми,
 * коментар — по панелі на групу, а не на елемент. До цього кожне значення й
 * кожна форма були власною панеллю, і людина бачила стовпчик однакових рамок,
 * у якому не видно, де закінчується одне значення й починається наступне.
 *
 * ПОЛЕ ВИГЛЯДАЄ ЯК ПОЛЕ (ADR-0034). Обрамлений блок, тло на щабель світліше за
 * панель, підпис-капітель над ним, синє кільце на фокусі — та сама модель, що
 * в `.field` решти застосунку (`base.css`). Раніше тут діяло правило «поверхня
 * одна»: поля без рамки й тла, самі плейсхолдером і курсором, — і на екран не
 * було видно, куди писати. Кожне поле має підпис (`ed-field-cap`); плейсхолдер
 * лишився тільки там, де показує формат («приклад | переклад»).
 *
 * ПРАВА КОЛОНКА ПОСТІЙНА. `−` у кожного рядка, `+` у підвалі — одна вертикаль
 * на всю панель. «×» стояв лише там, де було що прибирати, тож права межа
 * гуляла від рядка до рядка.
 *
 * Поза панелями ліній немає жодної: те, що між ними, розділяє порожнє місце.
 *
 * Перетворення стану форми в тіло запиту тут НЕ живе — воно в `card.ts` під
 * тестами. Причина в тому, що помилка там не падає, а тихо зносить значення
 * картки. Там само `applyProposal`: підстановка ШІ знищує роботу так само тихо.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError, OfflineError } from "../api/client";
import { proposeCard } from "../api/ai";
import { findByWord } from "../api/vocabulary";
import { useAuth } from "../auth/AuthProvider";
import { useOnline } from "../app/useOnline";
import {
  AddIcon,
  AiIcon,
  BackIcon,
  ChevronIcon,
  ListsIcon,
  RemoveIcon,
  OpenIcon,
  SaveButton,
  TrashIcon,
} from "../ui/parts";
import ConfirmSheet from "../ui/ConfirmSheet";
import PickerSheet from "../ui/PickerSheet";
import ListPickerSheet from "../vocabulary/ListPickerSheet";
import { Markdown } from "../grammar/markdown";
import {
  applyProposal,
  blankForm,
  blankSense,
  defaultListFor,
  deletionLosesHistory,
  draftHasContent,
  draftIsDirty,
  formIsBlank,
  newDraft,
  senseIsBlank,
  senseSummary,
  toCardPayload,
  toDraft,
  FORM_LABEL_SUGGESTIONS,
  POS_LABELS,
  type Card,
  type CardDraft,
  type PartOfSpeech,
} from "../vocabulary/card";
import {
  useCard,
  useCreateCard,
  useDeleteCard,
  useLists,
  useUpdateCard,
} from "../vocabulary/queries";
import { useSettings } from "../study/queries";
import { SpeakButton } from "../tts/SpeakButton";

const POS_ORDER: PartOfSpeech[] = [
  "n",
  "v",
  "adj",
  "adv",
  "prep",
  "pron",
  "conj",
  "num",
  "part",
  "int",
  "phr",
] as PartOfSpeech[];

/**
 * Службові значення аркуша міток: «набрати свою» і «без мітки». Обидва починаються
 * з пробілу, тобто справжньою міткою бути не можуть: `trim()` у `toCardPayload`
 * зробив би з них порожній рядок.
 *
 * Раніше тут стояв НЕ пробіл, а байт NUL. Роботі він не заважав, але через
 * нього `grep` вважав цей файл двійковим і мовчазно не показував жодного
 * збігу в ньому — у найбільшому екрані застосунку. `trim()` NUL не знімає,
 * тобто захист тримався на тому, що такого ніхто не набере, а не на правилі.
 */
const CUSTOM_LABEL = " custom";
const NO_LABEL = " none";

/** Те саме для аркуша частин мови: «не вказана». Кодом частини мови не є. */
const NO_POS = " none";

/**
 * Що показує підвал панелі слова замість пропозиції.
 *
 * `asking` окремим станом, а не просто `isPending`: Claude відповідає 2–5
 * секунд, і мовчання після тапу читається як зламана кнопка.
 */
type AiState =
  | { kind: "idle" }
  /** ШІ відмовився: не англійське слово. `hint` — на що це схоже. */
  | { kind: "refused"; message: string; hint: string | null }
  | { kind: "asking" }
  /** Заповнити не вийшло з причини, яка від слова не залежить. */
  | { kind: "blocked"; message: string };

/**
 * Що саме прибираємо — питання, яке ставить аркуш після `⋯`.
 */
type Removal =
  | { kind: "sense"; index: number }
  | { kind: "form"; index: number };

const REMOVAL_TITLES: Record<Removal["kind"], string> = {
  sense: "Прибрати значення?",
  form: "Прибрати форму?",
};

/**
 * Чому ШІ не заповнив — людською мовою.
 *
 * 422 сюди не потрапляє: відмова моделі має власний стан, бо з неї є що
 * зробити (виправити описку), а з решти — нічого.
 */
function aiFailure(problem: unknown): string {
  if (problem instanceof OfflineError) return "Потрібен звʼязок.";
  if (problem instanceof ApiError) {
    if (problem.code === "ai_word_already_filled")
      return "Це слово ШІ вже заповнював. Одне звернення на слово.";
    if (problem.code === "ai_not_configured")
      return "ШІ на цьому сервері не налаштований.";
    if (problem.code === "ai_access_denied") return "Доступу до ШІ немає.";
    if (problem.status === 502) return "Claude не відповів. Спробуйте ще раз.";
  }
  return "Не вдалось заповнити з ШІ.";
}

function FormLabelField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const known = (FORM_LABEL_SUGGESTIONS as readonly string[]).includes(value);
  const [typing, setTyping] = useState(() => value.trim() !== "" && !known);
  const [picking, setPicking] = useState(false);

  if (typing) {
    return (
      <span className="ed-label-field">
        <input
          className="ed-form-lbl"
          placeholder="своя мітка"
          aria-label="Мітка форми"
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="ed-label-back"
          aria-label="Вибрати мітку зі списку"
          title="Вибрати зі списку"
          onClick={() => {
            setTyping(false);
            onChange("");
          }}
        >
          <ChevronIcon />
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={value ? "ed-pick" : "ed-pick ed-pick-empty"}
        aria-label="Мітка форми"
        onClick={() => setPicking(true)}
      >
        <span className="ed-pick-val">{value || "без мітки"}</span>
        <ChevronIcon />
      </button>

      {picking ? (
        <PickerSheet
          title="Мітка форми"
          value={value || NO_LABEL}
          options={[
            { value: NO_LABEL, label: "без мітки" },
            ...FORM_LABEL_SUGGESTIONS.map((label) => ({
              value: label as string,
              label,
            })),
            /* Імпортована мітка поза четвіркою мусить лишитись у списку —
               інакше відкриття картки мовчки замінило б її на порожню. */
            ...(value && !known ? [{ value, label: value }] : []),
            /* Тепер це «своя мітка…», а не «своя…». Скорочення було потрібне
               рідному селекту: Chrome міряв його за найдовшим пунктом списку,
               і довгий останній пункт роздував поле назавжди. Аркуш нічого за
               списком не міряє. */
            { value: CUSTOM_LABEL, label: "своя мітка…" },
          ]}
          onPick={(picked) => {
            if (picked === CUSTOM_LABEL) {
              setTyping(true);
              onChange("");
              return;
            }
            onChange(picked === NO_LABEL ? "" : picked);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Приклади значення — одним полем.
 *
 * Рядок — приклад, риска ділить його на англійську й переклад; розбирає це
 * `parseExamples`, а не цей компонент. Наступний приклад починається з Enter,
 * тобто рукою, яка вже на клавіатурі, — раніше він починався з кнопки
 * «приклад +», а потім із двох окремих полів (ADR-0033).
 *
 * ВИСОТА ЗА ВМІСТОМ, І ЦЕ НЕ ПРИКРАСА. Приклад — це речення; у полі сталої
 * висоти воно або ховається під нижнім краєм, або (з `white-space: pre`)
 * їде вбік просто під час набору. Тому переносимо й ростемо, а браузер
 * висоту textarea сам не міряє — її ставить цей ефект.
 *
 * `rows={1}` навмисно: `scrollHeight` не вміє зменшуватись нижче заданої
 * висоти, тож перед вимірюванням висота скидається в `auto`. Без цього поле,
 * що один раз виросло до пʼяти рядків, лишалось би пʼятирядковим назавжди.
 *
 * МІРЯЄМО ТРИЧІ, І КОЖЕН РАЗ ПОТРІБНИЙ. Перший — на зміну тексту. Другий — коли
 * приїхали шрифти: перше вимірювання йде метриками запасного шрифту, і рядок,
 * якому з Onest треба два рядки, а з системним вистачало одного, лишався б
 * однорядковим — з `overflow: hidden` це означає обрізаний навпіл приклад, який
 * видно аж при відкритті картки. Третій — на зміну ширини вікна: перенос
 * залежить від неї, а поворот телефона її міняє.
 */
function ExamplesField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;

    const fit = () => {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    };

    fit();
    void document.fonts?.ready.then(fit);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);

  return (
    <label className="ed-field">
      <span className="ed-field-cap">Приклади</span>
      <textarea
        ref={field}
        className="ed-examples"
        rows={1}
        /* Плейсхолдер показує формат, а не називає поле: слово «приклад»
           ліворуч від риски і підписує, і демонструє. */
        placeholder="приклад | переклад"
        aria-label="Приклади — по одному в рядку, «приклад | переклад»"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export default function CardEditScreen({
  mode,
  cardId,
  onSaved,
  onDeleted,
  onClose,
}: {
  mode: "create" | "edit";
  /** Коли редактор не за маршрутом, а аркушем: id приходить пропом. */
  cardId?: number;
  /**
   * Збережена картка приходить сюди значенням, а не читається викликачем із
   * кешу: `onSuccess` мутації встигає покласти її туди, але компонент, що її
   * читає, на цю мить ще не перемальовано, і його `card.data` — попередня
   * версія. Тобто буфер навчання оновився б текстом, який щойно виправили.
   */
  onSaved?: (card: Card) => void;
  onDeleted?: (cardId: number) => void;
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const params = useParams();
  const { user } = useAuth();
  const id = mode === "edit" ? (cardId ?? Number(params.id)) : null;

  const card = useCard(id);
  const lists = useLists();
  const settings = useSettings();
  const create = useCreateCard();
  const update = useUpdateCard();
  const remove = useDeleteCard();

  const ownListIds = useMemo(
    () => (lists.data?.items ?? []).map((item) => item.id),
    [lists.data],
  );

  // Активний фільтр приходить зі списку через state — щоб «додати слово», не
  // виходячи з відкритого списку, клало картку саме туди.
  const activeListId =
    (location.state as { activeListId?: number | null } | null)?.activeListId ??
    null;

  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [initial, setInitial] = useState<CardDraft | null>(null);
  /** Наявна картка того самого слова — цілком, а не сам лише id: підвал
      показує її переклади, і саме вони відповідають на питання «це те саме
      слово чи інше». */
  const [duplicate, setDuplicate] = useState<Card | null>(null);
  const [ai, setAi] = useState<AiState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pickingLists, setPickingLists] = useState(false);
  const [asking, setAsking] = useState<
    "leave" | "delete" | "duplicate" | "replace" | null
  >(null);
  const [removing, setRemoving] = useState<Removal | null>(null);
  const [commentPreview, setCommentPreview] = useState(false);
  /** Індекс значення, якому зараз вибирають частину мови. */
  const [posPick, setPosPick] = useState<number | null>(null);

  useEffect(() => {
    if (draft) return;
    if (mode === "create") {
      if (!lists.data || !settings.data) return;
      const start = newDraft(
        defaultListFor(
          activeListId,
          settings.data.default_list_id ?? null,
          ownListIds,
        ),
      );
      setDraft(start);
      setInitial(start);
      return;
    }
    if (card.data) {
      const start = toDraft(card.data);
      setDraft(start);
      setInitial(start);
    }
  }, [
    mode,
    card.data,
    lists.data,
    settings.data,
    ownListIds,
    activeListId,
    draft,
  ]);

  if (!draft || !initial)
    return <div className="sheet-page">Завантаження…</div>;

  const patch = (next: Partial<CardDraft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  /** Слово змінилось — усе, що підвал казав про попереднє, більше не про це. */
  const patchWord = (word: string) => {
    setDuplicate(null);
    setAi({ kind: "idle" });
    patch({ word });
  };

  const patchForm = (
    index: number,
    next: Partial<CardDraft["forms"][number]>,
  ) => {
    const forms = [...draft.forms];
    const form = forms[index];
    if (!form) return;
    forms[index] = { ...form, ...next };
    patch({ forms });
  };

  const patchSense = (
    index: number,
    next: Partial<CardDraft["senses"][number]>,
  ) => {
    const senses = [...draft.senses];
    const sense = senses[index];
    if (!sense) return;
    senses[index] = { ...sense, ...next };
    patch({ senses });
  };

  const dirty = draftIsDirty(initial, draft);

  const leave = () => (onClose ? onClose() : navigate(-1));

  const close = () => {
    if (dirty) {
      setAsking("leave");
      return;
    }
    leave();
  };

  const openDuplicate = () => {
    if (!duplicate) return;
    // Раніше перехід ішов одразу й `replace: true` знищував набране без
    // питання. Тепер уся смуга — кнопка, тобто промахнутись стало легше.
    if (dirty) {
      setAsking("duplicate");
      return;
    }
    navigate(`/vocabulary/cards/${duplicate.id}`, { replace: true });
  };

  /**
   * Перевірка дубліката на виході з поля «слово».
   *
   * Один запит замість восьми, і все одно до того, як користувач набере
   * значення й приклади. 409 при збереженні лишається страховкою.
   */
  const checkDuplicate = async () => {
    setDuplicate(null);
    const word = draft.word.trim();
    if (!word || !online) return;
    if (mode === "edit" && card.data && card.data.word.trim() === word) return;

    try {
      const found = await findByWord(word);
      if (found && found.id !== id) setDuplicate(found);
    } catch {
      // Перевірка — зручність, а не умова збереження: сервер однаково дасть 409.
    }
  };

  const runAi = async () => {
    setAsking(null);
    setAi({ kind: "asking" });
    try {
      const proposal = await proposeCard(draft.word.trim());
      setDraft((current) => (current ? applyProposal(current, proposal) : current));
      setAi({ kind: "idle" });
    } catch (problem) {
      // Відмова — єдина невдача, з якої є що зробити: бекенд каже, на що схоже
      // слово, а виправляє людина. Саме слово ШІ не міняє ніколи (ADR-0027).
      if (problem instanceof ApiError && problem.status === 422) {
        const hint = problem.details?.did_you_mean;
        setAi({
          kind: "refused",
          message: problem.message,
          hint: typeof hint === "string" ? hint : null,
        });
        return;
      }
      setAi({ kind: "blocked", message: aiFailure(problem) });
    }
  };

  const pressAi = () => {
    if (!draft.word.trim()) {
      setAi({ kind: "blocked", message: "Спершу впишіть слово." });
      return;
    }
    // Питаємо ДО запиту, а не після: після другого разу людина погодиться
    // помилково, а звернення до того ж витрачене й слово спалене (ADR-0028).
    if (draftHasContent(draft)) {
      setAsking("replace");
      return;
    }
    void runAi();
  };

  const askRemove = (removal: Removal) => {
    // Порожній рядок втратою не є — це те саме правило, за яким він і так не
    // доїхав би до сервера. Питати про нього означало б питати про порожнечу.
    const blank =
      removal.kind === "sense"
        ? senseIsBlank(draft.senses[removal.index]!)
        : formIsBlank(draft.forms[removal.index]!);

    if (blank) {
      applyRemoval(removal);
      return;
    }
    setRemoving(removal);
  };

  const applyRemoval = (removal: Removal) => {
    if (removal.kind === "sense") {
      patch({ senses: draft.senses.filter((_, i) => i !== removal.index) });
    } else {
      patch({ forms: draft.forms.filter((_, i) => i !== removal.index) });
    }
    setRemoving(null);
  };

  const save = async () => {
    setError(null);
    const payload = toCardPayload(draft);
    if (!payload.word) {
      setError("Слово не може бути порожнім.");
      return;
    }

    try {
      if (mode === "create") {
        const created = await create.mutateAsync(payload);
        if (onSaved) onSaved(created);
        // Назад на той екран, з якого натиснули «+», а не на щойно створену
        // картку. Слова додають підряд, і картка, відкрита після кожного,
        // ставила б між двома словами зайвий крок «закрити». Побачити зроблене
        // однаково є де: на «Сьогодні» слово стає рядком у доданих за добу, у
        // словнику — першим рядком списку.
        else leave();
      } else {
        const saved = await update.mutateAsync({ id: id as number, payload });
        if (onSaved) onSaved(saved);
        else navigate(-1);
      }
    } catch (problem) {
      if (problem instanceof ApiError && problem.code === "card_exists") {
        setError(problem.message);
        return;
      }
      setError(
        problem instanceof Error
          ? problem.message
          : "Не вдалось зберегти картку",
      );
    }
  };

  const destroy = async () => {
    await remove.mutateAsync(id as number);
    setAsking(null);
    if (onDeleted) onDeleted(id as number);
    else navigate("/vocabulary", { replace: true });
  };

  const saving = create.isPending || update.isPending;
  const aiEnabled = user?.ai_enabled ?? false;

  const listItems = lists.data?.items ?? [];
  const selectedListNames = listItems
    .filter((list) => draft.listIds.includes(list.id))
    .map((list) => list.name);

  return (
    <div className="sheet-frame">
      <div className="sheet-head sheet-bar">
        <button
          className="icon-btn icon-btn-bare"
          type="button"
          aria-label="Назад"
          onClick={close}
        >
          <BackIcon />
        </button>
        <SaveButton
          onClick={save}
          disabled={!online || saving}
          state={saving ? "saving" : "idle"}
          title={online ? undefined : "Потрібен звʼязок"}
        />
      </div>

      <div className="sheet-scroll ed">
        <div className="ed-block ed-word-block">
          <div className="ed-item">
            <div className="ed-field">
              <span className="ed-field-cap">Слово</span>
              <div className="ed-word-row">
                <input
                  id="word"
                  className="ed-word-input"
                  aria-label="Слово"
                  value={draft.word}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => patchWord(event.target.value)}
                  onBlur={checkDuplicate}
                />
                <SpeakButton text={draft.word} size="md" />
                {aiEnabled ? (
                  <button
                    type="button"
                    className="ed-ai"
                    aria-label="Заповнити з ШІ"
                    title="Заповнити з ШІ"
                    disabled={!online || ai.kind === "asking"}
                    onClick={pressAi}
                  >
                    <AiIcon />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {duplicate ? (
            <button
              type="button"
              className="ed-note"
              aria-label={`Відкрити картку «${duplicate.word}»: ${
                senseSummary(duplicate) || "без перекладу"
              }`}
              onClick={openDuplicate}
            >
              <span className="ed-note-body">
                <span className="ed-note-label">Вже у словнику</span>
                <span className="ed-note-text">
                  {senseSummary(duplicate) || (
                    <span className="ed-note-empty">без перекладу</span>
                  )}
                </span>
              </span>
              <span className="ed-foot-act">
                <OpenIcon />
              </span>
            </button>
          ) : null}

          {ai.kind === "asking" ? (
            <div className="ed-note ed-note-still">
              <span className="ed-note-body">
                <span className="ed-note-label">Запитую ШІ…</span>
              </span>
            </div>
          ) : null}

          {ai.kind === "refused" ? (
            <div className="ed-note ed-note-still">
              <span className="ed-note-body">
                <span className="ed-note-label">ШІ не знає такого слова</span>
                <span className="ed-note-text">{ai.message}</span>
              </span>
              {/* Виправлення міняє нормалізоване слово, тобто ключ обмеження
                  «раз на слово», тобто дає нове право на звернення. */}
              {ai.hint ? (
                <button
                  type="button"
                  className="ed-note-act"
                  onClick={() => patchWord(ai.hint as string)}
                >
                  {ai.hint}
                </button>
              ) : null}
            </div>
          ) : null}

          {ai.kind === "blocked" ? (
            <div className="ed-note ed-note-still">
              <span className="ed-note-body">
                <span className="ed-note-label">ШІ не заповнив</span>
                <span className="ed-note-text">{ai.message}</span>
              </span>
            </div>
          ) : null}
        </div>

        {/* --- значення ---
            Панельної шапки немає: підпис несла б хіба слово «ЗНАЧЕННЯ», а що це
            значення, видно з підписів самих полів. Шапка лишається там, де їй є
            що нести, — перемикач у формах, вкладки в коментарі. */}
        <div className="ed-block">
          {draft.senses.map((sense, index) => (
            <div className="ed-item" key={index}>
              <div className="ed-row">
                {/* Не рідний `<select>`: на Android система малює його на весь
                    екран, і картка, заради якої його відкрили, зникає (ADR-0031). */}
                <div className="ed-field">
                  <span className="ed-field-cap">Частина мови</span>
                  <button
                    type="button"
                    className={
                      sense.partOfSpeech ? "ed-pick" : "ed-pick ed-pick-empty"
                    }
                    aria-label="Частина мови"
                    onClick={() => setPosPick(index)}
                  >
                    <span className="ed-pick-val">
                      {sense.partOfSpeech
                        ? POS_LABELS[sense.partOfSpeech]
                        : "не вказана"}
                    </span>
                    <ChevronIcon />
                  </button>
                </div>
                <label className="ed-field">
                  <span className="ed-field-cap">Транскрипція</span>
                  <input
                    className="ed-ipa"
                    aria-label="Транскрипція"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={sense.transcription}
                    onChange={(event) =>
                      patchSense(index, { transcription: event.target.value })
                    }
                  />
                </label>
                <button
                  className="ed-more"
                  type="button"
                  aria-label="Дії значення"
                  onClick={() => askRemove({ kind: "sense", index })}
                >
                  <RemoveIcon />
                </button>
              </div>

              <label className="ed-field">
                <span className="ed-field-cap">Переклад</span>
                <input
                  className="ed-tr"
                  aria-label="Переклад"
                  value={sense.translation}
                  onChange={(event) =>
                    patchSense(index, { translation: event.target.value })
                  }
                />
              </label>
              <ExamplesField
                value={sense.examples}
                onChange={(examples) => patchSense(index, { examples })}
              />
            </div>
          ))}

          <button
            className="ed-foot"
            type="button"
            onClick={() => patch({ senses: [...draft.senses, blankSense()] })}
          >
            <span className="ed-foot-label">Ще значення</span>
            <span className="ed-foot-act">
              <AddIcon />
            </span>
          </button>
        </div>

        {/* --- форми ---
            Шапка тут є, бо їй є що нести: перемикач тренування. Над
            значеннями шапки немає — там нести нічого. */}
        <div className="ed-block">
          <div className="ed-head">
            <span className="ed-head-label">Форми</span>
            {draft.forms.length > 0 ? (
              <button
                type="button"
                role="switch"
                aria-checked={draft.formsDrillEnabled}
                className="ed-switch"
                data-on={draft.formsDrillEnabled || undefined}
                // Вимкнення не видаляє доріжку і не скидає прогрес — вона
                // просто зникає з черги.
                onClick={() =>
                  patch({ formsDrillEnabled: !draft.formsDrillEnabled })
                }
              >
                <span className="ed-switch-label">Тренувати</span>
                {/* Той самий перемикач, що в профілі: доріжка `.sw`. Свого
                    вигляду в редактора немає навмисно — це один орган. */}
                <span className={draft.formsDrillEnabled ? "sw sw-on" : "sw"}>
                  <i />
                </span>
              </button>
            ) : null}
          </div>

          {draft.forms.map((form, index) => (
            <div className="ed-item" key={index}>
              <div className="ed-row">
                <label className="ed-field">
                  <span className="ed-field-cap">Форма</span>
                  <input
                    className="ed-form-val"
                    aria-label="Форма"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={form.value}
                    onChange={(event) =>
                      patchForm(index, { value: event.target.value })
                    }
                  />
                </label>
                <SpeakButton text={form.value} />
                <button
                  className="ed-more"
                  type="button"
                  aria-label="Дії форми"
                  onClick={() => askRemove({ kind: "form", index })}
                >
                  <RemoveIcon />
                </button>
              </div>

              {/* Та сама мала пара, що в значенні: мітка й транскрипція. */}
              <div className="ed-row">
                <div className="ed-field">
                  <span className="ed-field-cap">Мітка</span>
                  <FormLabelField
                    value={form.label}
                    onChange={(label) => patchForm(index, { label })}
                  />
                </div>
                <label className="ed-field">
                  <span className="ed-field-cap">Транскрипція</span>
                  <input
                    className="ed-ipa"
                    aria-label="Транскрипція форми"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={form.transcription}
                    onChange={(event) =>
                      patchForm(index, { transcription: event.target.value })
                    }
                  />
                </label>
              </div>
            </div>
          ))}

          <button
            className="ed-foot"
            type="button"
            onClick={() => patch({ forms: [...draft.forms, blankForm()] })}
          >
            <span className="ed-foot-label">Ще форма</span>
            <span className="ed-foot-act">
              <AddIcon />
            </span>
          </button>
        </div>

        {/* --- коментар ---
            Перемикач «Текст / Перегляд» — той самий компонент і той самий
            рендерер Markdown, що в редакторі граматичної нотатки
            (`NoteEditScreen`), перенесений сюди без власної логіки. Слово
            «Коментар» стоїть рівно один раз, у шапці — у textarea
            плейсхолдера немає, інакше вийшло б те саме слово вдруге. */}
        <div className="ed-block">
          <div className="ed-head">
            <span className="ed-head-label">Коментар</span>
            <span className="ed-tabs">
              <button
                type="button"
                className={commentPreview ? "ed-tab" : "ed-tab ed-tab-on"}
                onClick={() => setCommentPreview(false)}
              >
                Текст
              </button>
              <button
                type="button"
                className={commentPreview ? "ed-tab ed-tab-on" : "ed-tab"}
                onClick={() => setCommentPreview(true)}
              >
                Перегляд
              </button>
            </span>
          </div>

          <div className="ed-item">
            {commentPreview ? (
              <div className="ed-preview">
                {draft.comment.trim() ? (
                  <Markdown source={draft.comment} />
                ) : (
                  <div className="hint">Коментар порожній.</div>
                )}
              </div>
            ) : (
              <textarea
                id="comment"
                className="ed-comment-input"
                aria-label="Коментар"
                rows={3}
                value={draft.comment}
                onChange={(event) => patch({ comment: event.target.value })}
              />
            )}
          </div>
        </div>
        <div className="ed-field">
          <span className="ed-field-cap">Списки</span>
          <button
            type="button"
            className="ed-list-trigger"
            onClick={() => setPickingLists(true)}
          >
            <ListsIcon />
            <span
              className={
                selectedListNames.length ? undefined : "ed-list-trigger-empty"
              }
            >
              {selectedListNames.length
                ? selectedListNames.join(", ")
                : "Без списку"}
            </span>
          </button>
        </div>

        {error ? <div className="msg msg-error">{error}</div> : null}
        {mode === "edit" ? (
          <div className="ed-destroy">
            <button
              className="icon-btn ed-trash"
              type="button"
              aria-label="Видалити слово"
              disabled={!online || remove.isPending}
              title={online ? "Видалити слово" : "Потрібен звʼязок"}
              onClick={() => setAsking("delete")}
            >
              <TrashIcon />
            </button>
          </div>
        ) : null}
      </div>

      {asking === "leave" ? (
        <ConfirmSheet
          title="Вийти без збереження?"
          note="Усе, що набрано на цьому екрані, зникне."
          confirmLabel="Вийти"
          onConfirm={leave}
          onCancel={() => setAsking(null)}
        />
      ) : null}

      {asking === "duplicate" && duplicate ? (
        <ConfirmSheet
          title={`Відкрити «${duplicate.word}»?`}
          note="Усе, що набрано на цьому екрані, зникне."
          confirmLabel="Відкрити"
          onConfirm={() =>
            navigate(`/vocabulary/cards/${duplicate.id}`, { replace: true })
          }
          onCancel={() => setAsking(null)}
        />
      ) : null}

      {asking === "replace" ? (
        <ConfirmSheet
          title="Замінити значення й форми?"
          // ШІ не бачить картки й пропонує з нуля, тож підстановка не
          // доповнює, а заміняє (ADR-0027). Коментар при цьому в безпеці —
          // його пропозиція заповнює лише порожній.
          note="ШІ пропонує з нуля: те, що вже набрано, зникне. Коментар лишиться."
          confirmLabel="Замінити"
          onConfirm={() => void runAi()}
          onCancel={() => setAsking(null)}
        />
      ) : null}

      {removing ? (
        <ConfirmSheet
          title={REMOVAL_TITLES[removing.kind]}
          confirmLabel="Прибрати"
          onConfirm={() => applyRemoval(removing)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}

      {posPick !== null ? (
        <PickerSheet
          title="Частина мови"
          value={draft.senses[posPick]?.partOfSpeech ?? NO_POS}
          options={[
            { value: NO_POS, label: "не вказана" },
            ...POS_ORDER.map((pos) => ({ value: pos as string, label: POS_LABELS[pos]! })),
          ]}
          onPick={(picked) =>
            patchSense(posPick, {
              partOfSpeech: picked === NO_POS ? null : (picked as PartOfSpeech),
            })
          }
          onClose={() => setPosPick(null)}
        />
      ) : null}

      {asking === "delete" && card.data ? (
        <ConfirmSheet
          title={`Видалити «${card.data.word}»?`}
          // Діалог мусить називати справжній наслідок. Стан доріжок уже в
          // payload, тож окремий запит за кількістю відповідей не потрібен
          // (ADR-0003).
          note={
            deletionLosesHistory(card.data)
              ? "Разом зі словом зникне історія повторень — відновити її буде нічим."
              : "Слово зникне зі словника."
          }
          confirmLabel="Видалити слово"
          busy={remove.isPending}
          onConfirm={() => void destroy()}
          onCancel={() => setAsking(null)}
        />
      ) : null}

      {pickingLists ? (
        <ListPickerSheet
          items={listItems}
          selected={draft.listIds}
          defaultListId={settings.data?.default_list_id ?? null}
          onToggle={(id) =>
            patch({
              listIds: draft.listIds.includes(id)
                ? draft.listIds.filter((value) => value !== id)
                : [...draft.listIds, id],
            })
          }
          onClose={() => setPickingLists(false)}
        />
      ) : null}
    </div>
  );
}
