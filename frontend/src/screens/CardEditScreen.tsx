/**
 * Редактор картки — створення і правка одним екраном.
 *
 * Живе у двох рамах: як екран за маршрутом і як аркуш поверх навчання
 * (`CardEditSheet`). Через це виходи параметризовані — `onSaved`, `onDeleted`,
 * `onClose`. Другого редактора для «швидкої правки» немає навмисно: помилка в
 * картці буває в будь-якому полі, і скорочена форма ловила б рівно ті, які
 * встиг передбачити автор скорочення.
 *
 * Приклади вводяться парою полів, а не рядком «English | переклад»: половина
 * прикладів словника має український переклад, і в текстовому варіанті кожен
 * такий приклад означав би лізти по «|» у третій рівень мобільної клавіатури.
 *
 * Мітка форми має чотири підказки (`FORM_LABEL_SUGGESTIONS`), і показуються
 * вони, лише поки поле порожнє. Це навмисно не випадаючий список: форми стоять
 * у нижній третині довгого екрана, тобто список під полем відкривався б рівно
 * туди, де стоїть клавіатура. Чипи ж живуть у потоці й нічого не затуляють, а
 * стану «поле в режимі вибору / поле в режимі вводу» не існує взагалі.
 *
 * Про підписи полів. Їх тут менше, ніж полів: підпис лишається там, де без
 * нього не зрозуміти, що вписувати, і зникає там, де це видно з самого поля.
 * «Приклад англійською» над полем, у якому вже стоїть «приклад», — це не
 * пояснення, а другий рядок висоти.
 *
 * Перетворення стану форми в тіло запиту тут НЕ живе — воно в `card.ts` під
 * тестами. Причина в тому, що помилка там не падає, а тихо зносить значення
 * картки.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { findByWord } from "../api/vocabulary";
import { useOnline } from "../app/useOnline";
import { BackIcon, ListsIcon, SaveButton, TrashIcon } from "../ui/parts";
import ConfirmSheet from "../ui/ConfirmSheet";
import ListPickerSheet from "../vocabulary/ListPickerSheet";
import {
  blankExample,
  blankForm,
  blankSense,
  defaultListFor,
  deletionLosesHistory,
  draftIsDirty,
  newDraft,
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
  const [duplicate, setDuplicate] = useState<{
    id: number;
    word: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickingLists, setPickingLists] = useState(false);
  const [asking, setAsking] = useState<"leave" | "delete" | null>(null);

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
      if (found && found.id !== id) {
        setDuplicate({ id: found.id, word: found.word });
      }
    } catch {
      // Перевірка — зручність, а не умова збереження: сервер однаково дасть 409.
    }
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

  const listItems = lists.data?.items ?? [];
  const selectedListNames = listItems
    .filter((list) => draft.listIds.includes(list.id))
    .map((list) => list.name);

  return (
    <div className="sheet-frame">
      {/* Смуга прибита: у картки з чотирма значеннями редактор довший за екран,
          і «Зберегти» їхало геть разом із полями. */}
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
        {/* Слово набирається дисплейною гарнітурою на письмовій лінійці, а не в
          такому самому полі, як коментар: це головне, заради чого існує вся
          решта екрана. Підпису над ним немає — порожня лінійка з великим
          курсором не буває нічим іншим. */}
        <div className="ed-word-field">
          <input
            id="word"
            className="ed-word"
            aria-label="Слово"
            value={draft.word}
            placeholder="hold on"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => patch({ word: event.target.value })}
            onBlur={checkDuplicate}
          />
          {/* Динамік стоїть НА письмовій лінійці, а не окремим рядком під нею:
            він перевіряє щойно набране слово, а не є ще одним полем. */}
          <SpeakButton text={draft.word} size="md" className="spk-on-rule" />
        </div>

        {duplicate ? (
          <div className="msg msg-error">
            «{duplicate.word}» уже у вашому словнику.{" "}
            <button
              className="btn-link"
              type="button"
              onClick={() =>
                navigate(`/vocabulary/cards/${duplicate.id}`, { replace: true })
              }
            >
              Відкрити
            </button>
          </div>
        ) : null}

        {/* --- значення ---
            Заголовка більше немає: панель під ним каже сама за себе (селект
            частини мови, поле перекладу), а другий підпис того самого слова
            тільки забирав рядок висоти. */}
        {draft.senses.map((sense, index) => (
          <div className="ed-panel" key={index}>
            <div className="ed-row">
              <select
                className="ed-pos"
                aria-label="Частина мови"
                value={sense.partOfSpeech ?? ""}
                onChange={(event) =>
                  patchSense(index, {
                    partOfSpeech: (event.target.value ||
                      null) as PartOfSpeech | null,
                  })
                }
              >
                <option value="">частина мови</option>
                {POS_ORDER.map((pos) => (
                  <option key={pos} value={pos}>
                    {POS_LABELS[pos]}
                  </option>
                ))}
              </select>
              {/* Транскрипція набирається тим самим стеком, яким показується: у
                даних вона буває і справжньою IPA, і кирилицею. Стоїть у парі з
                частиною мови, бо обидві короткі й обидві необовʼязкові. */}
              <input
                className="ed-ipa"
                placeholder="транскрипція"
                aria-label="Транскрипція"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={sense.transcription}
                onChange={(event) =>
                  patchSense(index, { transcription: event.target.value })
                }
              />
              {draft.senses.length > 1 ? (
                <button
                  className="ed-drop"
                  type="button"
                  aria-label="Прибрати значення"
                  onClick={() =>
                    patch({
                      senses: draft.senses.filter((_, i) => i !== index),
                    })
                  }
                >
                  ×
                </button>
              ) : null}
            </div>

            <input
              className="ed-tr"
              placeholder="переклад"
              aria-label="Переклад"
              value={sense.translation}
              onChange={(event) =>
                patchSense(index, { translation: event.target.value })
              }
            />

            {sense.examples.map((example, exampleIndex) => (
              <div className="ed-example" key={exampleIndex}>
                <div className="ed-example-fields">
                  <input
                    placeholder="приклад"
                    aria-label="Приклад англійською"
                    value={example.textEn}
                    onChange={(event) => {
                      const examples = [...sense.examples];
                      examples[exampleIndex] = {
                        ...example,
                        textEn: event.target.value,
                      };
                      patchSense(index, { examples });
                    }}
                  />
                  <input
                    placeholder="переклад"
                    aria-label="Переклад прикладу"
                    value={example.textUk}
                    onChange={(event) => {
                      const examples = [...sense.examples];
                      examples[exampleIndex] = {
                        ...example,
                        textUk: event.target.value,
                      };
                      patchSense(index, { examples });
                    }}
                  />
                </div>
                <button
                  className="ed-drop"
                  type="button"
                  aria-label="Прибрати приклад"
                  onClick={() =>
                    patchSense(index, {
                      examples: sense.examples.filter(
                        (_, i) => i !== exampleIndex,
                      ),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}

            <button
              className="ed-add ed-add-inner"
              type="button"
              onClick={() =>
                patchSense(index, {
                  examples: [...sense.examples, blankExample()],
                })
              }
            >
              + приклад
            </button>
          </div>
        ))}

        <button
          className="ed-add"
          type="button"
          onClick={() => patch({ senses: [...draft.senses, blankSense()] })}
        >
          + значення
        </button>

        {/* --- форми --- */}
        {draft.forms.map((form, index) => (
          <div className="ed-panel" key={index}>
            <div className="ed-row">
              <input
                className="ed-form-lbl"
                placeholder="мітка"
                aria-label="Мітка форми"
                value={form.label}
                onChange={(event) =>
                  patchForm(index, { label: event.target.value })
                }
              />
              <input
                className="ed-form-val"
                placeholder="форма"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={form.value}
                onChange={(event) =>
                  patchForm(index, { value: event.target.value })
                }
              />
              <button
                className="ed-drop"
                type="button"
                aria-label="Прибрати форму"
                onClick={() =>
                  patch({ forms: draft.forms.filter((_, i) => i !== index) })
                }
              >
                ×
              </button>
            </div>

            {/* Підказки зникають, щойно в полі зʼявляється текст: тоді вибирати
              вже нема з чого, а місце потрібне формі. */}
            {form.label.trim() === "" ? (
              <div className="ed-chips">
                {FORM_LABEL_SUGGESTIONS.map((label) => (
                  <button
                    key={label}
                    className="chip chip-sm"
                    type="button"
                    onClick={() => patchForm(index, { label })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            {/* Динамік озвучує саме форму, але стоїть у рядку транскрипції, а не
              поруч із «×»: сусідство з видаленням форми — це промах пальця, що
              коштує набраного, заради того, щоб послухати слово. */}
            <div className="ed-ipa-row">
              <input
                className="ed-ipa"
                placeholder="транскрипція"
                aria-label="Транскрипція форми"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={form.transcription}
                onChange={(event) =>
                  patchForm(index, { transcription: event.target.value })
                }
              />
              <SpeakButton text={form.value} />
            </div>
          </div>
        ))}
        <button
          className="ed-add"
          type="button"
          onClick={() => patch({ forms: [...draft.forms, blankForm()] })}
        >
          + форма
        </button>

        {draft.forms.length > 0 ? (
          <label className="ed-check">
            <input
              type="checkbox"
              checked={draft.formsDrillEnabled}
              onChange={(event) =>
                patch({ formsDrillEnabled: event.target.checked })
              }
            />
            {/* Вимкнення не видаляє доріжку і не скидає прогрес — вона просто
              зникає з черги. */}
            Тренувати форми окремою доріжкою
          </label>
        ) : null}

        {/* --- коментар --- */}
        <input
          id="comment"
          className="ed-comment"
          aria-label="Коментар"
          placeholder="коментар"
          value={draft.comment}
          onChange={(event) => patch({ comment: event.target.value })}
        />

        {/* --- списки: останні, бо міняються найрідше ---
            Раніше тут стояла стіна чипів, яка розпадалась на криві рядки,
            щойно серед коротких назв траплялась одна довга («Прикметники,
            прислівники і прийменники»). Тепер це один рядок, як «коментар»
            вище, — відкриває аркуш із повним списком, де кожній назві
            вистачає всієї ширини. */}
        <button
          type="button"
          className="ed-list-trigger"
          onClick={() => setPickingLists(true)}
        >
          <ListsIcon />
          <span className={selectedListNames.length ? undefined : "ed-list-trigger-empty"}>
            {selectedListNames.length
              ? selectedListNames.join(", ")
              : "Без списку — це нормально"}
          </span>
        </button>

        {error ? <div className="msg msg-error">{error}</div> : null}

        {/* Видалення — остання річ у прокрутці, іконкою.
            Далі від «Зберегти» нікуди: промахнутись пальцем неможливо, а
            догортати сюди заради незворотної дії — не ціна, а запобіжник. */}
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
