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
 * Дії рядка в редакторі.
 *
 * Три крапки, а не «×». Різниця не в гліфі: «×» стояв лише там, де було що
 * прибирати (значення показувало його з другого, приклад — завжди), тож права
 * межа панелі гуляла від рядка до рядка. Три крапки стоять у кожного рядка, і
 * саме тому вони складаються в колонку.
 */
/**
 * Прибрати рядок.
 *
 * Була `MoreIcon` — три крапки, тобто обіцянка меню. Меню там ніколи не було:
 * кнопка має рівно одну дію, і на порожньому рядку вона навіть не питає
 * (`askRemove`). Лінія тієї ж довжини, що й ряд крапок (5→19), нічого не
 * обіцяє понад те, що робить.
 *
 * Хрестика тут немає навмисно, і це не косметика: «×» стояв би лише там, де є
 * що прибирати, і права колонка панелі гуляла б від рядка до рядка. Лінія
 * стоїть завжди.
 */
export function RemoveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

/** Шеврон «розкрити»: у тригері вибору й у поверненні до списку міток. */
export function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 10l5 5 5-5" />
    </svg>
  );
}

/**
 * Додати ще один такий самий рядок.
 *
 * Той самий розмір і та сама колонка, що в `MoreIcon`: підвал панелі — це
 * останній її рядок, а не окрема кнопка між панелями.
 */
export function AddIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

/**
 * ШІ — заповнити картку з нуля.
 *
 * Іскри намальовані, а не взяті емодзі ✨, з тієї самої причини, що динамік:
 * системне емодзі малюється кольоровою картинкою, а насичений колір у
 * застосунку належить рампі сяйва (ADR-0012). Ця бере `currentColor`.
 *
 * Три іскри різного розміру, а не зірка й не робот: пропозиція — це кілька
 * різних речей одразу (значення, форми, транскрипція), і жодна з них не
 * головна.
 */
export function AiIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 3.5l1.7 4.3 4.3 1.7-4.3 1.7L11 15.5 9.3 11.2 5 9.5l4.3-1.7z" />
      <path d="M17.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
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

/**
 * Рядок панелі з підписом ліворуч і перемикачем праворуч.
 *
 * Замінив пару чипів «Увімкнено / Вимкнено». Пара чипів завжди коштувала двох
 * рядків — рубрики над ними й самої пари — і показувала обидві відповіді там,
 * де питання одне: чипом «Вимкнено» ніхто не користувався інакше, ніж щоб
 * вимкнути.
 *
 * Плата, яку варто знати: перемикач вимагає, щоб підпис називав УВІМКНЕНИЙ
 * стан («Повільніше», а не «Темп»). Інакше незрозуміло, що саме він робить.
 */
export function Switch({
  label,
  on,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  /** Дрібним під підписом. Для того, що інакше пішло б окремим рядком `.hint`. */
  hint?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      className="sw-row"
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="sw-text">
        <span className="sw-label">{label}</span>
        {hint ? <span className="sw-hint">{hint}</span> : null}
      </span>
      <span className={on ? "sw sw-on" : "sw"} aria-hidden="true">
        <i />
      </span>
    </button>
  );
}

/**
 * Вибір одного з двох-трьох варіантів суцільною доріжкою.
 *
 * Це той самий орган, яким на «Сьогодні» вибирають напрямок показу, — саме
 * тому він тут, а не в профілі: доріжка перестала бути пристроєм одного
 * екрана. Замінив ряди чипів у профілі, бібліотеці й імпорті.
 *
 * Різниця з чипами не косметична: чипи — це N окремих предметів, між якими око
 * щоразу шукає, котрий із них засвічений, а доріжка — один предмет, у якому
 * видно позицію. Тому вона й дозволена лише на короткі набори: від чотирьох
 * поділок доріжка знову розсипається на предмети.
 *
 * Погашена поділка означає «цього тут немає» (голосу на пристрої), а не
 * «зачекай» — гасити можна лише тоді, коли це вже точно відомо.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  /** Читається екранним читачем; візуально підпис стоїть окремо в рядку. */
  label: string;
  value: T | undefined;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            className={on ? "on" : ""}
            type="button"
            aria-pressed={on}
            title={option.title}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
