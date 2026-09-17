/**
 * Рядок словника.
 *
 * Живе тут, а не всередині екрана «Словник», бо малюють його двоє: сам словник
 * і «Сьогодні», де ним показані слова, додані за добу. Один компонент, а не два
 * схожі: слово, побачене на головному екрані, мусить виглядати точно так само,
 * як воно ж у словнику, — два трохи різні записи читались би як два різні види
 * записів.
 *
 * Рядок навмисно бідний: без крапки «час повторити» (після імпорту прострочені
 * всі доріжки, і вона стояла б на кожному рядку) і без тегів списків (540 із
 * 608 карток лежать в одному списку, тобто тег не ніс би інформації).
 *
 * Єдине, що рядок каже понад текст, — температура на лівій рисці (ADR-0017).
 */

import { senseSummary, distinctTranscriptions, type Card } from "./card";
import { cardTemperature } from "../study/temperature";
import { SpeakButton } from "../tts/SpeakButton";

export default function CardRow({
  card,
  onOpen,
  selected,
}: {
  card: Card;
  /** У режимі вибору — перемкнути позначку, інакше відкрити картку. */
  onOpen: () => void;
  /** `undefined` — режиму вибору немає. */
  selected?: boolean;
}) {
  const selecting = selected !== undefined;

  const summary = senseSummary(card);
  const transcriptions = distinctTranscriptions(card);
  // Довге «слово» — не рідкість: у словнику є цілі речення на 61 символ. Тоді
  // транскрипція поруч не поміститься, і показувати її не варто.
  const longWord = card.word.length > 24;

  // Рядок — не кнопка, а смуга з кнопкою всередині: динамік поруч мусить бути
  // окремим органом, а кнопка в кнопці недопустима в розмітці й непередбачувана
  // в поведінці.
  return (
    <div
      className={selected ? "v-row v-row-on" : "v-row"}
      // Риска ліворуч несе температуру (ADR-0017). Підказкою вона тут бути не
      // може: поруч уже стоїть переклад, тобто ховати нічого — на відміну від
      // закритої картки навчання, де той самий колір заборонений (ADR-0016).
      style={{ "--temp": cardTemperature(card.tracks) } as React.CSSProperties}
    >
      <button
        className="v-row-main"
        type="button"
        aria-pressed={selecting ? selected : undefined}
        onClick={onOpen}
      >
        <span className="v-word-line">
          <span className="v-word">{card.word}</span>
          {!longWord && transcriptions.length > 0 ? (
            <span className="v-ipa">{transcriptions.join(" · ")}</span>
          ) : null}
          {card.forms.length > 0 ? <span className="v-tag">форми</span> : null}
        </span>
        {summary ? <span className="v-tr">{summary}</span> : null}
      </button>
      {/* У режимі вибору динамік поступається позначкою: ціль на тому ж місці
          мусить робити те саме, що й решта рядка. */}
      {selecting ? (
        <span className="v-check" aria-hidden="true" onClick={onOpen} />
      ) : (
        <SpeakButton text={card.word} className="spk-row" />
      )}
    </div>
  );
}
