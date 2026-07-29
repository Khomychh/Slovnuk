/**
 * Динамік — той самий орган у шести місцях: рядок словника, перегляд картки
 * (слово, приклад, форма), редактор (слово, форма) і навчання.
 *
 * Іконка намальована, а не взята емодзі 🔊, як у старому PWA, і причина не
 * естетична: емодзі на телефоні малюється кольоровою картинкою системи, а
 * ADR-0012 лишає насичений колір рампі сяйва. Намальований динамік бере
 * `currentColor` і поводиться як решта іконок застосунку.
 *
 * Стан «говорю» показується кольором і другою хвилею. Це не прикраса: синтез
 * інколи мовчки не спрацьовує (немає голосу, iOS не зняв замок), і без
 * зворотного звʼязку кнопка виглядала б зламаною однаково і тоді, коли вона
 * працює зі звуком, вимкненим на самому телефоні.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import { useSettings } from "../study/queries";
import {
  getVoiceState,
  speak,
  speechAvailable,
  subscribeVoices,
  type Accent,
  type VoiceState,
} from "./speech";

/** Голоси пристрою. Потрібні лише панелі профілю — вона гасить порожні акценти. */
export function useVoices(): VoiceState {
  return useSyncExternalStore(subscribeVoices, getVoiceState, getVoiceState);
}

export type Tts = {
  /** Чи показувати динаміки взагалі. */
  enabled: boolean;
  /** Чи озвучувати картку в навчанні без натискання. */
  autoplay: boolean;
  accent: Accent;
  slow: boolean;
  /** Сказати вголос. Обіцянка виконується, коли голос замовк. */
  say: (text: string) => Promise<void>;
};

/**
 * Налаштування озвучення в тому вигляді, у якому їх питає інтерфейс.
 *
 * Доки налаштувань немає, озвучення поводиться як вимкнене. Це не збіг із
 * серверним дефолтом (`tts_enabled=True`), а свідомий вибір напрямку помилки:
 * невідомість триває мить — дзеркало в IndexedDB віддає останні відомі
 * налаштування навіть без мережі, — і промовчати цю мить не коштує нічого,
 * тоді як заговорити в тиші вагона коштує рівно того, заради чого вимикач
 * існує.
 */
export function useTts(): Tts {
  const settings = useSettings();
  const data = settings.data;

  const enabled = speechAvailable && (data?.tts_enabled ?? false);
  const accent = data?.tts_accent ?? "auto";
  const slow = data?.tts_slow ?? false;

  const say = useCallback(
    (text: string) => (enabled ? speak(text, { accent, slow }) : Promise.resolve()),
    [enabled, accent, slow],
  );

  return { enabled, autoplay: enabled && (data?.tts_autoplay ?? false), accent, slow, say };
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9h3.4L12 5.2v13.6L7.4 15H4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M15.4 9.6a3.6 3.6 0 0 1 0 4.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Друга хвиля зʼявляється лише поки звучить голос. */}
      <path
        className="spk-wave"
        d="M18.3 7a7.4 7.4 0 0 1 0 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Кнопка «прослухати».
 *
 * Нічого не малює, коли озвучення вимкнене або текст порожній: вимкнений
 * динамік — це тиша, а не сіра кнопка, яка чекає на випадковий дотик.
 */
export function SpeakButton({
  text,
  size = "sm",
  className,
}: {
  text: string | null | undefined;
  /** `md` — біля слова, `sm` — біля прикладу, форми чи в рядку списку. */
  size?: "sm" | "md";
  className?: string;
}) {
  const { enabled, say } = useTts();
  const [speaking, setSpeaking] = useState(false);

  const value = text?.trim() ?? "";
  if (!enabled || !value) return null;

  return (
    <button
      type="button"
      className={["spk", size === "md" ? "spk-md" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      data-on={speaking || undefined}
      aria-label="Прослухати"
      title="Прослухати"
      onClick={(event) => {
        // Батьківські обробники тут зайві: у словнику рядок відкриває картку, у
        // навчанні тап розкриває відповідь. Динамік не робить ні того, ні того.
        event.stopPropagation();
        setSpeaking(true);
        void say(value).finally(() => setSpeaking(false));
      }}
    >
      <SpeakerIcon />
    </button>
  );
}
