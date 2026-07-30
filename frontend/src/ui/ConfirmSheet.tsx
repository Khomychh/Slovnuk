/**
 * Підтвердження незворотної дії.
 *
 * Замінює `window.confirm` в усьому застосунку. Причина не тільки в тому, що
 * системне вікно виглядає чужим: воно ще й показує URL сайту у власній шапці й
 * не вміє показати НАСЛІДОК окремо від питання. А наслідок тут — головне: між
 * «список буде видалено» і «разом зі словом зникне історія повторень»
 * різниця в тому, чи людина натисне.
 *
 * Кольору небезпеки тут немає, і це не недогляд: семафор заборонено в усьому
 * застосунку (ADR-0012), тож вагу несуть слово й розмір, а не червоне тло.
 * Через це підпис дії мусить називати саму дію — «Видалити слово», а не
 * «Так»: «Так» на кнопці без кольору не каже нічого.
 *
 * Скасувати можна трьома шляхами — кнопкою, дотиком до затемнення й Esc.
 * Найдешевший шлях мусить вести до безпечного боку.
 */

import { useEffect, useRef } from "react";

export default function ConfirmSheet({
  title,
  note,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  /** Питання. Називає предмет: «Видалити „run“?» */
  title: string;
  /**
   * Що станеться незворотного. Не переказ питання іншими словами: якщо додати
   * нічого, краще не передавати нічого.
   */
  note?: string;
  /** Підпис дії. Дієслово, те саме, що привело сюди. */
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Фокус іде на дію, а не на скасування: клавіатурою сюди потрапляють рідко, і
  // коли потрапляють — уже знаючи, чого хочуть. Esc поруч, і він безпечний.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="sheet-scrim" onClick={onCancel}>
      <div
        className="sheet confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-body">
          <div className="sheet-title">{title}</div>
          {/* Волосяна лінія ліворуч — той самий знак, що в прикладах картки:
              «це примітка до того, що вище», а не другий абзац питання. */}
          {note ? <p className="confirm-note">{note}</p> : null}
        </div>

        <div className="confirm-acts">
          <button
            ref={confirmRef}
            className="btn"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Зачекайте…" : confirmLabel}
          </button>
          <button className="btn-quiet" type="button" onClick={onCancel}>
            Скасувати
          </button>
        </div>
      </div>
    </div>
  );
}
