/**
 * Чиста логіка словника: усе, що можна перевірити без мережі й без React.
 *
 * Найнебезпечніше тут — `toCardPayload`. Семантика `CardUpdateSchema` така, що
 * `senses: []` означає «стерти всі значення», а відсутнє поле — «не чіпати».
 * Помилка в цьому перетворенні не падає й не показує помилки: вона тихо зносить
 * значення картки, і помічаєш ти це аж тоді, коли слово приходить на повторення
 * порожнім. Саме тому тут Vitest, а не жива перевірка.
 */

import { words } from "../ui/plural";
import type { components } from "../api/schema";

export type Card = components["schemas"]["CardSchema"];

/**
 * Вміст картки — рівно те, що потрібно, щоб її намалювати: слово, значення,
 * форми, коментар.
 *
 * Це `QueueCardSchema`, і назва тут не випадкова. Черга віддає картку без
 * `list_ids`, `created_at` і `tracks`, а `CardSchema` — з ними; структурно
 * повна картка підходить усюди, де чекають вміст, а не навпаки. Завдяки цьому
 * перегляд картки й картка навчання малюються тим самим кодом (ADR-0016).
 */
export type CardContent = components["schemas"]["QueueCardSchema"];

export type CardCreate = components["schemas"]["CardCreateSchema"];
export type CardUpdate = components["schemas"]["CardUpdateSchema"];
export type WordList = components["schemas"]["WordListSchema"];
export type PartOfSpeech = components["schemas"]["PartOfSpeechEnum"];

/** Стан одного прикладу в редакторі. `id` є лише в того, що вже в базі. */
export type ExampleDraft = {
  id: number | null;
  textEn: string;
  textUk: string;
};

/**
 * «Уточнення» (`gloss`) тут немає і не було потрібне: у 608 картках експорту
 * воно заповнене в 7 значеннях із 721, і пʼять із семи — випадкові натискання
 * («m», «t»). Поле знесено цілком разом із колонкою.
 */
export type SenseDraft = {
  id: number | null;
  partOfSpeech: PartOfSpeech | null;
  translation: string;
  transcription: string;
  examples: ExampleDraft[];
};

export type FormDraft = {
  id: number | null;
  label: string;
  value: string;
  transcription: string;
};

export type CardDraft = {
  word: string;
  comment: string;
  formsDrillEnabled: boolean;
  listIds: number[];
  senses: SenseDraft[];
  forms: FormDraft[];
};

export const POS_LABELS: Record<string, string> = {
  n: "іменник",
  v: "дієслово",
  adj: "прикметник",
  adv: "прислівник",
  prep: "прийменник",
  pron: "займенник",
  conj: "сполучник",
  num: "числівник",
  part: "частка",
  int: "вигук",
  phr: "фраза",
};

/**
 * Підказки для мітки форми — рівно ті рядки, що йдуть у базу.
 *
 * Порядок за частотою у власному словнику (157 форм): `Past` — 78, `P.P.` —
 * 51, `Plural` — 12, `Gerund` — 4. Разом 145 зі 157, тож чотирьох досить, і
 * решта одинадцять міток лишаються справою вільного вводу — вони одноразові
 * за природою («Скорочене заперечення», «фізична відстань»).
 *
 * Англійською і без перекладу навмисно: підпис на чипі мусить збігатися зі
 * збереженим значенням. Інакше в словнику зʼявиться дві мови для одного
 * поняття — 78 імпортованих `Past` і нові «Мин. час», які не зійдуться ні в
 * пошуку, ні на очах.
 *
 * Списку «моїх останніх міток» тут немає свідомо: за 608 карток жодна
 * нестандартна мітка не повторилась двічі, тож такий список підказував би
 * «брехати» як рівноправний варіант поруч із `Past`.
 */
export const FORM_LABEL_SUGGESTIONS = ["Past", "P.P.", "Plural", "Gerund"] as const;

/** Коротка позначка частини мови для рядка списку: «бігти (дієсл.)». */
const POS_SHORT: Record<string, string> = {
  n: "ім.",
  v: "дієсл.",
  adj: "прикм.",
  adv: "присл.",
  prep: "прийм.",
  pron: "займ.",
  conj: "спол.",
  num: "числ.",
  part: "част.",
  int: "виг.",
  phr: "фраза",
};

export function blankExample(): ExampleDraft {
  return { id: null, textEn: "", textUk: "" };
}

export function blankSense(): SenseDraft {
  return {
    id: null,
    partOfSpeech: null,
    translation: "",
    transcription: "",
    examples: [],
  };
}

export function blankForm(): FormDraft {
  return { id: null, label: "", value: "", transcription: "" };
}

/**
 * Картка з сервера → стан редактора.
 *
 * Порожні поля приїжджають як `null`, а `<input value>` не приймає null без
 * попередження React, тож усе текстове зводиться до рядків тут, а не по одному
 * в кожному полі.
 */
export function toDraft(card: Card): CardDraft {
  return {
    word: card.word,
    comment: card.comment ?? "",
    formsDrillEnabled: card.forms_drill_enabled,
    listIds: [...card.list_ids],
    senses: card.senses.map((sense) => ({
      id: sense.id,
      partOfSpeech: sense.part_of_speech ?? null,
      translation: sense.translation ?? "",
      transcription: sense.transcription ?? "",
      examples: sense.examples.map((example) => ({
        id: example.id,
        textEn: example.text_en,
        textUk: example.text_uk ?? "",
      })),
    })),
    forms: card.forms.map((form) => ({
      id: form.id,
      label: form.label ?? "",
      value: form.value,
      transcription: form.transcription ?? "",
    })),
  };
}

/** Нова картка. Список підставляється правилом `defaultListFor`. */
export function newDraft(listIds: number[]): CardDraft {
  return {
    word: "",
    comment: "",
    formsDrillEnabled: true,
    listIds,
    senses: [blankSense()],
    forms: [],
  };
}

const trimmed = (value: string) => value.trim();
const orNull = (value: string) => (value.trim() ? value.trim() : null);

/**
 * Чи заповнено у значенні хоч щось.
 *
 * Дзеркало `WordSenseWriteSchema.is_blank`: порожнім вважається лише те, де
 * немає НІЧОГО, включно з частиною мови. Строгіший критерій «немає перекладу»
 * відкинув би живі картки — у «that is why» перекладу немає, а транскрипція і
 * приклади є.
 *
 * Сервер відсіює порожніх дітей і сам, але робити це тут теж треба: інакше
 * «додав рядок і передумав» перетворювався б на видимий порожній рядок після
 * збереження, бо відповідь повертається без нього, а форма про це не знає.
 */
export function senseIsBlank(sense: SenseDraft): boolean {
  return (
    sense.partOfSpeech === null &&
    !sense.translation.trim() &&
    !sense.transcription.trim() &&
    sense.examples.every((example) => !example.textEn.trim())
  );
}

export function formIsBlank(form: FormDraft): boolean {
  // Мітка без самої форми нічого не тренує — так само в WordFormWriteSchema.
  return !form.value.trim();
}

/**
 * Стан редактора → тіло запиту.
 *
 * `id` дітей зберігаються навмисно: з ними сервер оновлює наявний рядок, без
 * них створює новий. Ми могли б слати все без `id` — на них ніщо не
 * посилається, доріжки живуть на картці, — але тоді кожне збереження
 * перестворювало б значення й приклади, а `apply_senses` вважав би зниклі
 * id видаленими. Різниці для користувача немає, шуму в базі — багато.
 *
 * Масиви йдуть завжди, і це те, що робить `PATCH` небезпечним: порожній масив
 * означає «стерти все». Саме тому порожні діти відсіюються ДО перетворення, а
 * не після.
 */
export function toCardPayload(draft: CardDraft): CardCreate & CardUpdate {
  const senses = draft.senses.filter((sense) => !senseIsBlank(sense));
  const forms = draft.forms.filter((form) => !formIsBlank(form));

  return {
    word: trimmed(draft.word),
    comment: orNull(draft.comment),
    forms_drill_enabled: draft.formsDrillEnabled,
    list_ids: [...draft.listIds],
    senses: senses.map((sense) => ({
      ...(sense.id === null ? {} : { id: sense.id }),
      part_of_speech: sense.partOfSpeech,
      translation: orNull(sense.translation),
      transcription: orNull(sense.transcription),
      examples: sense.examples
        .filter((example) => example.textEn.trim())
        .map((example) => ({
          ...(example.id === null ? {} : { id: example.id }),
          text_en: trimmed(example.textEn),
          text_uk: orNull(example.textUk),
        })),
    })),
    forms: forms.map((form) => ({
      ...(form.id === null ? {} : { id: form.id }),
      label: orNull(form.label),
      value: trimmed(form.value),
      transcription: orNull(form.transcription),
    })),
  };
}

/**
 * Куди кладеться нова картка.
 *
 * Порядок правил: активний фільтр списку → список за замовчуванням → жодного.
 * Це те саме, що робив `presetAddList` у старому PWA з розкритим акордеоном,
 * тільки явно: при плоскому корені розкритого списку не існує (ADR-0011).
 *
 * «Жодного» — нормальний результат, а не збій: користувач міг не позначити
 * дефолт, або позначений список щойно видалили (тоді FK обнулив позначку).
 */
export function defaultListFor(
  activeListId: number | null,
  defaultListId: number | null | undefined,
  ownListIds: readonly number[],
): number[] {
  if (activeListId !== null && ownListIds.includes(activeListId)) {
    return [activeListId];
  }
  if (defaultListId != null && ownListIds.includes(defaultListId)) {
    return [defaultListId];
  }
  return [];
}

/**
 * Чи має видалення попереджати про втрату історії.
 *
 * Стан доріжок уже їде в `CardSchema`, тож лічильник записів повторень
 * запитувати не треба. Усі доріжки `new` — картку жодного разу не показували,
 * втрачати нічого. Будь-яка інша — разом із карткою зникнуть `review_logs`
 * (ADR-0003), і відновити їх не буде чим.
 */
export function deletionLosesHistory(card: Card): boolean {
  return card.tracks.some((track) => track.state !== "new");
}

/**
 * Підпис під словом у рядку списку: «бігти (дієсл.); керувати».
 *
 * Значення без перекладу пропускаються — у рядку від них нема користі, хоча
 * самі вони не порожні (можуть мати транскрипцію і приклади). Дзеркало
 * `senseSummary` зі старого PWA.
 */
export function senseSummary(card: Card): string {
  return card.senses
    .map((sense) => {
      const translation = (sense.translation ?? "").trim();
      if (!translation) return "";
      const short = sense.part_of_speech
        ? POS_SHORT[sense.part_of_speech]
        : undefined;
      return short ? `${translation} (${short})` : translation;
    })
    .filter(Boolean)
    .join("; ");
}

/**
 * Транскрипції картки без повторів — «go [ɡəʊ]».
 *
 * Кілька значень часто мають ту саму вимову; показувати її двічі безглуздо.
 */
export function distinctTranscriptions(card: CardContent): string[] {
  const seen = new Set<string>();
  for (const sense of card.senses) {
    const value = (sense.transcription ?? "").trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

/** Чи змінилось хоч щось — від цього залежить питання при виході з редактора. */
export function draftIsDirty(before: CardDraft, after: CardDraft): boolean {
  return JSON.stringify(toCardPayload(before)) !== JSON.stringify(toCardPayload(after));
}

/**
 * Яку частку словника займає список — ширина смуги під його рядком.
 *
 * Знаменник — усі картки користувача, а не сума карток по списках: списки це
 * мітки, тож картка може лежати у двох, а може ні в одному, і сума їхніх
 * лічильників не дорівнює словнику ні в той, ні в інший бік. На живих даних це
 * добре видно: 540 із 608 в одному списку дають майже повну смугу.
 *
 * Порожній словник дає нуль, а не діління на нуль. Дуже малий список отримує
 * мінімум 1.5% — інакше смуга зникає зовсім і рядок читається як зламаний.
 */
export function listFraction(cardCount: number, totalCards: number): number {
  if (totalCards <= 0 || cardCount <= 0) return 0;
  const share = (cardCount / totalCards) * 100;
  return Math.min(100, Math.max(1.5, share));
}

/**
 * Монорядок під назвою списку:
 * «54 СЛОВА · ЗА ЗАМОВЧУВАННЯМ · ПОДІЛЕНО · В БІБЛІОТЕЦІ».
 *
 * Стан кажеться словами, а не кольорами й не другим станом іконок: тоді іконка
 * шеру лишається просто входом, а не носієм інформації, якої на ній не
 * прочитати. Тим самим шляхом іде й Бібліотека — п'ятої іконки в рядку немає
 * навмисно: при 36px на кнопку вона з'їла б назву до одинадцяти символів, і
 * «Фразові дієслова» почали б різатись.
 *
 * «Поділено» і «в бібліотеці» — різні стани й можуть стояти разом: посилання
 * адресне, публікація — на загал, і одне не заміняє інше.
 */
export function listStateLine(
  list: Pick<WordList, "card_count" | "share_token" | "in_library">,
  isDefault: boolean,
): string {
  const parts = [words(list.card_count)];
  if (isDefault) parts.push("за замовчуванням");
  if (list.share_token) parts.push("поділено");
  if (list.in_library) parts.push("в бібліотеці");
  return parts.join(" · ");
}
