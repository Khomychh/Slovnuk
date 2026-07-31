/** Дрібні спільні шматки інтерфейсу. Нічого розумного тут немає навмисно. */

import type { ReactNode } from "react";

export function Screen({
  eyebrow,
  title,
  aside,
  back,
  foot,
  children,
}: {
  eyebrow?: string;
  title?: string;
  /** Правий верхній кут шапки — там живе аватар профілю на «Сьогодні». */
  aside?: ReactNode;
  /**
   * Смуга дій, прибита до низу екрана — над панеллю вкладок, якщо вона є.
   *
   * Не частина `children` навмисно: вона мусить лишитись ПОЗА областю, що
   * прокручується, інакше головна дія екрана їде геть разом із вмістом. Саме
   * тому `Screen` віддає фрагмент із двох вузлів, а не один `.screen`: обидва
   * стають дітьми колонки `.shell`, і низ тримається сам.
   */
  foot?: ReactNode;
  /**
   * Повернення на рівень вище. Коли передано, у шапці стає шеврон ліворуч
   * заголовка — той самий, що в шапках редакторів.
   *
   * До цього екрани-нащадки («Списки», «Розділи») мали кнопку `.btn-quiet` на
   * всю ширину під заголовком: смуга 14px заввишки з підписом «‹ Назад», яка
   * важила більше за все інше на екрані. Шеврон поруч із назвою заодно каже, у
   * якій ти вкладці, — тому рубрику на цих екранах прибрано.
   */
  back?: () => void;
  children: ReactNode;
}) {
  return (
    <>
    <div className="screen">
      {eyebrow || title || aside || back ? (
        <div className="screen-head">
          <div className="screen-head-main">
            {back ? (
              <button
                className="icon-btn icon-btn-bare screen-back"
                type="button"
                aria-label="Назад"
                onClick={back}
              >
                <BackIcon />
              </button>
            ) : null}
            <div>
              {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
              {title ? <h1 className="h-title">{title}</h1> : null}
            </div>
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </div>
    {foot ? <div className="screen-foot">{foot}</div> : null}
    </>
  );
}

export function Field({
  label,
  ...input
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={input.id}>{label}</label>
      <input {...input} />
    </div>
  );
}

/* --- іконки --------------------------------------------------------------
   Малюються, а не беруться емодзі: емодзі на телефоні системa малює кольоровою
   картинкою, а ADR-0012 лишає насичений колір рампі сяйва. Усі однакового
   розміру полотна (24) і на `currentColor`, тож колір задає кнопка. */

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Іконка збереження. Одна на весь застосунок — у шапці редактора картки, у
 * редакторі нотатки, у двох блоках профілю і на кнопці нового пароля.
 *
 * Галочка, а не дискета: дискети користувач цього застосунку в житті не бачив,
 * а галочка в правому куті верхньої панелі — те, чим підтверджують форму на
 * будь-якому телефоні.
 */
export function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 12.5l5 5 10-11"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Налаштування навчання — на нижній поличці кнопки «Вчити».
 *
 * Шестерня, а не повзунки: повзунки — це стос горизонтальних рисок, тобто
 * силует `ListsIcon` із шапки «Словника». Дві іконки, які відрізняються лише
 * дрібницею всередині, — це одна іконка, яку доводиться розглядати.
 *
 * Зубці стоять ЗОВНІ обода, а не тягнуться від центра. Перша спроба була
 * «мале коло і вісім променів від нього» — на 18 пікселях це читалось сонцем,
 * бо сонце саме так і малюють. Два концентричні кола з короткими зубцями по
 * зовнішньому колі ні на що інше не схожі.
 */
export function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="2.1" />
      <circle cx="12" cy="12" r="5.6" />
      <path d="M12 6.4V4.1M12 17.6v2.3M6.4 12H4.1M17.6 12h2.3M8.04 8.04L6.34 6.34M15.96 15.96l1.7 1.7M15.96 8.04l1.7-1.7M8.04 15.96l-1.7 1.7" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

/**
 * Шер. Три вузли й дві грані — це впізнаване «поділитись» і на Android, і на
 * iOS, на відміну від системного «квадрат зі стрілкою», який на Android нічого
 * не означає.
 */
export function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M15.8 6.8L8.2 10.7M8.2 13.3l7.6 3.9" />
    </svg>
  );
}

/**
 * Публікація в Бібліотеці. Стоїть у рядку «Списків» поруч із шером, тож мусить
 * відрізнятись від нього з першого погляду.
 *
 * Ті самі три книжки, що на вкладці «Бібліотека», — не стрілка «вивантажити» й не
 * глобус: обидва означали б «віддати назовні», тобто те саме, що вже означає шер.
 * Різниця не в дії, а в місці, куди список потрапляє.
 */
export function LibraryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19V7M9 19V5M14 19V8" />
      <path d="M17.5 8.5l2.5 10" />
      <path d="M3 20h18" />
    </svg>
  );
}

/**
 * «Списки» — вхід у шапці «Словника».
 *
 * Стос рядків із кульками, різної довжини. Не три книжки (`LibraryIcon`): за
 * тим екраном лежить і чуже, і своє, а книжки в цьому застосунку означають саме
 * Бібліотеку, тобто чуже. Не три голі смуги: такими підписано «Прогрес».
 * Розводить їх кулька на початку рядка й те, що ця іконка кольорова, а вкладки
 * ні.
 *
 * Єдина іконка застосунку, яка не бере колір із `currentColor`: штрих залито
 * стрічкою сяйва. Це не порушення ADR-0012, а те саме правило, за яким живуть
 * риска активної вкладки й кнопка «Вчити» — стрічка ЦІЛКОМ є підписом
 * застосунку, і лише окрема її зупинка означає температуру.
 *
 * Зупинки беруться з тих самих змінних, що й `--aurora`: інакше рампа
 * роздвоїлась би, і при зміні теми іконка лишилась би зі старими кольорами.
 */
export function ListsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="aurora-lists" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: "var(--a0)" }} />
          <stop offset="20%" style={{ stopColor: "var(--a1)" }} />
          <stop offset="40%" style={{ stopColor: "var(--a2)" }} />
          <stop offset="60%" style={{ stopColor: "var(--a3)" }} />
          <stop offset="80%" style={{ stopColor: "var(--a4)" }} />
          <stop offset="100%" style={{ stopColor: "var(--a5)" }} />
        </linearGradient>
      </defs>
      <g
        stroke="url(#aurora-lists)"
        strokeWidth="2"
        strokeLinecap="round"
      >
        {/* Кульки окремим штрихом нульової довжини: із круглим кінцем вони
            малюються точками того самого градієнта, тобто без другого кольору
            й без жодного зайвого вузла. */}
        <path d="M4 6h0M4 12h0M4 18h0" />
        <path d="M9 6h11M9 12h7M9 18h9" />
      </g>
    </svg>
  );
}

/**
 * Стрілка «відкрити» — картка дубліката в редакторі слова.
 *
 * Та сама діагональ, яку скрізь впізнають як «перейти», а не «більше про»:
 * тут вона веде на вже наявну картку того самого слова, а не розгортає щось
 * на місці.
 */
export function OpenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

/**
 * Кнопка збереження — скрізь однакова.
 *
 * Тексту немає навмисно: підпис «Зберегти» займав третину верхньої панелі, а
 * дію в цьому місці однаково впізнають за іконкою. Стан кажуть `title` і
 * `aria-label`, тобто він лишається доступним, просто не займає місця.
 *
 * Галочка гола — ні рамки, ні тла. До цього вона сиділа на плитці `--frost`,
 * тобто була єдиним майже білим прямокутником у застосунку й важила більше за
 * заголовок екрана. Тепер вона дзеркальна до шеврона «назад» у тій самій
 * шапці: зберегти й вийти — дві рівноправні дії по краях панелі, і жодна не
 * кричить. Не «поверніть кнопці тло, її не видно»: видно її за тим, що вона
 * єдина світла (`--frost`) серед приглушених, а коли зберігати нема чого —
 * гасне.
 *
 * Окремого кольору для «збережено» немає — ADR-0012 забороняє зелене як
 * «успіх».
 */
export function SaveButton({
  onClick,
  disabled,
  state = "idle",
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** `saving` — запит у польоті, `saved` — змін немає, бо щойно зберегли. */
  state?: "idle" | "saving" | "saved";
  /** Причина недоступності, коли вона не в тому, що зберігати нічого. */
  title?: string;
}) {
  const label =
    state === "saving" ? "Збереження…" : state === "saved" ? "Збережено" : "Зберегти";

  return (
    <button
      className="btn-save"
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-busy={state === "saving" || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <SaveIcon />
    </button>
  );
}

export function Message({
  kind = "info",
  children,
}: {
  kind?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={kind === "error" ? "msg msg-error" : "msg"}
      role={kind === "error" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}
