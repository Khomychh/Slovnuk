/**
 * Обличчя картки — те, як картка виглядає, коли вона відкрита.
 *
 * Цей модуль існує, бо картку малюють ДВА екрани: навчання після перевороту і
 * перегляд слова зі словника (ADR-0016). Раніше все це жило всередині
 * `StudyScreen.tsx`, а перегляд мав власну, схожу, але іншу розмітку — і два
 * описи того самого поняття розходились би тихо: додав поле в одному місці,
 * забув у другому, помітив через місяць.
 *
 * Береться `CardContent`, не `Card`: черга віддає картку без `list_ids` і
 * `tracks`, і жодне з них тут не потрібне. Списки, доріжки й дії над карткою —
 * справа екрана, а не обличчя.
 *
 * Панелі тут теж немає. `.card-panel` разом зі сяйвом ставить екран: у навчанні
 * воно залежить від того, перевернуто картку чи ні, а в перегляді горить завжди.
 */

import { SpeakButton } from "../tts/SpeakButton";
import { distinctTranscriptions, type CardContent } from "./card";

/**
 * Скорочення частин мови.
 *
 * Саме скорочення, а не повні назви з `POS_LABELS`: тут вони стоять міткою
 * поруч зі значенням, і «дієслово» на 9 пікселях розрідженого моношрифту
 * важило б більше за сам переклад.
 *
 * Не експортується: мітка лишилась рівно в одному місці — у деталях значення.
 * З лиця «укр → англ» її прибрано, бо питання поставлене рідною мовою, і що
 * «храм» — іменник, людина знає без підказки.
 */
const POS_LABEL: Record<string, string> = {
  n: "ім.",
  v: "дієсл.",
  adj: "прикм.",
  adv: "присл.",
  prep: "прийм.",
  phr: "фраза",
  other: "інше",
};

/** Кегль слова: 61-символьні «слова» в словнику є, і вони цілі речення. */
export function headwordClass(word: string): string {
  if (word.length > 34) return "headword tiny";
  if (word.length > 16) return "headword small";
  return "headword";
}

/** Слово з динаміком поруч. Кнопка стоїть там, де стоїть слово, — і тільки там. */
export function Headword({ word, className }: { word: string; className: string }) {
  return (
    <div className="head-line">
      <div className={className}>{word}</div>
      <SpeakButton text={word} size="md" />
    </div>
  );
}

export function Examples({
  examples,
}: {
  examples: CardContent["senses"][number]["examples"];
}) {
  if (examples.length === 0) return null;
  return (
    <div className="ex">
      {examples.map((example) => (
        <p key={example.id}>
          {example.text_en}
          <SpeakButton text={example.text_en} />
          {example.text_uk ? <span className="ex-tr">{example.text_uk}</span> : null}
        </p>
      ))}
    </div>
  );
}

export function Forms({
  forms,
  note,
}: {
  forms: CardContent["forms"];
  /**
   * Приписка до заголовка. Вживає її лише перегляд — сказати, що доріжку форм
   * вимкнено. У навчанні такої приписки бути не може: якби доріжку вимкнули,
   * картка форм сюди б і не приїхала.
   */
  note?: string;
}) {
  if (forms.length === 0) return null;
  return (
    <div className="forms">
      <div className="forms-h">Форми{note ? ` · ${note}` : ""}</div>
      {forms.map((form) => (
        <div className="frow" key={form.id}>
          <span className="flbl">{form.label ?? "форма"}</span>
          <span>{form.value}</span>
          {form.transcription ? <span className="fipa">{form.transcription}</span> : null}
          <SpeakButton text={form.value} className="spk-end" />
        </div>
      ))}
    </div>
  );
}

export function SenseBlocks({ card }: { card: CardContent }) {
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

/**
 * Усе, що видно на розкритій картці: значення з прикладами, форми, коментар.
 *
 * Порядок несе сенс і тому зашитий тут, а не складається на кожному екрані:
 * спершу те, заради чого слово вчать, потім те, що до нього додається, і
 * наприкінці власна нотатка. Переставити його місцями на одному з екранів —
 * значить зробити два різні застосунки з одного.
 */
export function CardBody({ card, formsNote }: { card: CardContent; formsNote?: string }) {
  return (
    <>
      <SenseBlocks card={card} />
      <Forms forms={card.forms} note={formsNote} />
      {card.comment ? <div className="cmt">{card.comment}</div> : null}
    </>
  );
}
