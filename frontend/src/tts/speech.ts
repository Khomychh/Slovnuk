/**
 * Озвучення: Web Speech API і правила навколо нього.
 *
 * Межа всередині файлу навмисна. Верхня половина — чисті функції над простими
 * значеннями: що озвучити само, який голос узяти, чи існує на цьому пристрої
 * потрібний акцент. Вони накриті Vitest. Нижня половина чіпає
 * `window.speechSynthesis`, і перевірити її можна лише живим браузером — у
 * jsdom цього API немає взагалі.
 *
 * Аудіо ніде не зберігається: голос синтезується пристроєм, тому озвучення
 * працює без мережі, але його наявність і набір голосів — властивість
 * пристрою, а не акаунта (CONTEXT.md, «Озвучення»).
 *
 * Українське не озвучується ніде й ніколи: голос тут — про вимову англійського
 * слова, а не про читання картки вголос.
 */

import type { components } from "../api/schema";
import type { CardSide, QueueItem } from "../study/session";

export type Accent = components["schemas"]["TtsAccentEnum"];

/**
 * Мінімум від `SpeechSynthesisVoice`, потрібний правилам.
 *
 * Тести дають сюди підробку: конструктора `SpeechSynthesisVoice` не існує, і
 * зібрати справжній голос у тесті нічим.
 */
export type VoiceLike = { name: string; lang: string };

/** Повільно — 0.7, як у старому PWA. Швидше за 1 не буває: це не програвач. */
const RATE_SLOW = 0.7;
const RATE_NORMAL = 1;

/**
 * Скільки чекати на кінець висловлювання, перш ніж вважати його завершеним.
 *
 * Сторож, а не таймаут синтезу: Chrome інколи не віддає ні `end`, ні `error`,
 * і без нього кнопка світилась би «говорю» до кінця життя екрана. Речення
 * прикладу на повільному темпі — це секунд вісім, тож п'ятнадцять із запасом.
 */
const SPEECH_GUARD_MS = 15_000;

// --- чисті правила ---

/** Регіон із мітки мови: `en-GB` → `GB`, `en_US` → `US`, `en` → `""`. */
function region(voice: VoiceLike): string {
  return ((voice.lang ?? "").replace(/_/g, "-").split("-")[1] ?? "").toUpperCase();
}

function isEnglish(voice: VoiceLike): boolean {
  return ((voice.lang ?? "").split(/[-_]/)[0] ?? "").toLowerCase() === "en";
}

/** Голоси, які взагалі розглядаються. Неанглійський голос тут ні до чого. */
export function englishVoices<T extends VoiceLike>(voices: T[]): T[] {
  return voices.filter(isEnglish);
}

/**
 * Чи є на цьому пристрої голос під цей акцент.
 *
 * Саме це гасить кнопку в профілі. На iPhone англійських голосів шість, і всі
 * три кнопки чесні; на Android голоси ставляться пакетами, і типово стоїть
 * рівно один — тоді «UK» підсвічувалась би вибраною, а голос лишався б
 * американським. Три кнопки, з яких дві означають одне й те саме, — інтерфейс,
 * що бреше.
 */
export function accentAvailable(voices: VoiceLike[], accent: Accent): boolean {
  const english = englishVoices(voices);
  if (accent === "auto") return english.length > 0;
  const wanted = accent === "us" ? "US" : "GB";
  return english.some((voice) => region(voice) === wanted);
}

/**
 * Який голос узяти.
 *
 * Відкат на перший-ліпший англійський навмисний: акцент зберігається на
 * сервері, тож на іншому пристрої британського голосу може не бути. Промовчати
 * в цьому випадку гірше, ніж сказати слово тим голосом, який є, — а правду про
 * підміну каже профіль, де кнопка без голосу погашена.
 */
export function pickVoice<T extends VoiceLike>(voices: T[], accent: Accent): T | null {
  const [first] = englishVoices(voices);
  if (!first) return null;
  if (accent === "auto") return first;
  const wanted = accent === "us" ? "US" : "GB";
  return englishVoices(voices).find((voice) => region(voice) === wanted) ?? first;
}

/**
 * Що озвучити само в навчанні.
 *
 * Правило одне на всі три обличчя картки: **звучить слово рівно тоді, коли
 * англійське слово вперше видно**. На лицьовій в «англ → укр» і на доріжці
 * форм, у момент розкриття — в «укр → англ», де на лицьовій його немає й бути
 * не може (голос проговорив би відповідь).
 *
 * Форми самі не озвучуються ніколи, хоча спокуса є: їх буває три, черга з
 * трьох висловлювань відстає від пальця, що вже тягнеться до оцінки, і
 * перетворюється на шум, який хочеться перебити. Друга причина важливіша:
 * автоозвучення має описуватись одним реченням, інакше незрозуміло, що саме
 * вимикає `tts_autoplay`. Кожна форма лишається за кнопкою на своєму рядку.
 */
export function autoplayText(
  item: QueueItem,
  side: CardSide,
  revealed: boolean,
): string | null {
  const word = item.card.word?.trim();
  if (!word) return null;

  // Доріжка форм показує слово на лицьовій, як і «англ → укр»: `cardSide`
  // віддає для неї "en_uk", але покладатись на це не варто — обличчя картки
  // будується по `kind`, а не по стороні (`buildFaces` у StudyScreen).
  const wordShownOn = item.kind === "forms" || side === "en_uk" ? "front" : "back";
  const showing = revealed ? "back" : "front";

  return showing === wordShownOn ? word : null;
}

// --- браузер ---

/** Чи вміє цей браузер озвучувати взагалі. */
export const speechAvailable =
  typeof window !== "undefined" &&
  "speechSynthesis" in window &&
  "SpeechSynthesisUtterance" in window;

export type VoiceState = {
  voices: VoiceLike[];
  /**
   * Чи можна вже щось стверджувати про набір голосів.
   *
   * `getVoices()` на першому кадрі часто віддає порожній масив, а справжній
   * список приїжджає подією `voiceschanged`; у PWA це інколи трапляється лише
   * після першої взаємодії користувача. Тому «порожньо» і «ще не знаємо» —
   * різні стани, і плутати їх не можна: у другому не можна гасити кнопки
   * акценту, бо це було б твердження без підстав.
   */
  ready: boolean;
};

let voiceState: VoiceState = { voices: [], ready: false };
const listeners = new Set<() => void>();

function publish(next: VoiceState): void {
  voiceState = next;
  for (const listener of listeners) listener();
}

/** Перечитати список голосів у системи. */
export function refreshVoices(): void {
  if (!speechAvailable) return;
  let voices: VoiceLike[] = [];
  try {
    voices = window.speechSynthesis.getVoices() ?? [];
  } catch {
    voices = [];
  }
  if (voices.length === 0 && !voiceState.ready) return;
  publish({ voices, ready: true });
}

export function subscribeVoices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVoiceState(): VoiceState {
  return voiceState;
}

if (speechAvailable) {
  refreshVoices();
  try {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      // Подія сама по собі означає, що система відповіла, — навіть якщо
      // список порожній. Саме тут «ще не знаємо» перетворюється на «немає».
      publish({ voices: voiceState.voices, ready: true });
      refreshVoices();
    });
  } catch {
    /* старі браузери без addEventListener на synth — переживемо без події */
  }
}

export type SpeakOptions = { accent: Accent; slow: boolean };

/**
 * Сказати текст уголос. Обіцянка виконується, коли голос замовк.
 *
 * Попереднє висловлювання перебивається: на картці ти натискаєш динамік
 * повторно саме тому, що не дослухав, і черга з двох однакових слів тут нікому
 * не потрібна.
 */
export function speak(text: string, options: SpeakOptions): Promise<void> {
  const value = text.trim();
  if (!speechAvailable || !value) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(value);
      const voice = pickVoice(window.speechSynthesis.getVoices() ?? [], options.accent);
      if (voice) {
        utterance.voice = voice as SpeechSynthesisVoice;
        utterance.lang = voice.lang;
      } else {
        // Голосу не знайшли — це ще не привід мовчати: рушій часто має
        // вбудований запасний і без явного вибору говорить сам.
        utterance.lang = "en-US";
      }
      utterance.rate = options.slow ? RATE_SLOW : RATE_NORMAL;

      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        resolve();
      };
      const guard = setTimeout(done, SPEECH_GUARD_MS);

      utterance.onend = done;
      // `cancel()` із сусідньої кнопки теж приходить сюди — і це правильно:
      // це висловлювання справді закінчилось.
      utterance.onerror = done;

      window.speechSynthesis.speak(utterance);
    } catch {
      resolve();
    }
  });
}

export function stopSpeaking(): void {
  if (!speechAvailable) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* нічого не поробиш, та й нічого страшного */
  }
}

/**
 * Відімкнути синтез першим дотиком користувача.
 *
 * **Це не мертвий код, і прибрати його означає тихо зламати автоозвучення на
 * айфонах.** iOS Safari (а PWA на айфоні — це Safari) виконує `speak()` лише
 * тоді, коли перший за життя сторінки виклик пішов ЗСЕРЕДИНИ обробника жесту.
 * Виклик із React-ефекту жестом не вважається, тож перша картка не озвучилась
 * би — і друга, і третя, доки користувач не натисне ручний динамік, після чого
 * автоозвучення раптом ожило б до кінця сесії.
 *
 * Порожнє висловлювання на нульовій гучності знімає замок і не чути. На
 * Android і в десктопному Chrome воно не робить нічого — саме тому поломку тут
 * не побачити на машині розробника.
 *
 * Заразом це нагода перечитати голоси: у PWA список інколи порожній рівно до
 * першої взаємодії.
 */
export function unlockSpeech(): void {
  if (!speechAvailable) return;
  try {
    const primer = new SpeechSynthesisUtterance(" ");
    primer.volume = 0;
    window.speechSynthesis.speak(primer);
  } catch {
    /* замок не знявся — ручний динамік лишається запасним шляхом */
  }
  refreshVoices();
}
