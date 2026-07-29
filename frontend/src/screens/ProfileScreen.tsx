/**
 * Профіль: імʼя, аватар, денні цілі, обліковий запис.
 *
 * Чого тут немає і чому:
 *
 * — **Теми.** Палітри світлої теми не існує (`theme.css` тримає одну), тож
 *   перемикач був би мертвим органом керування. Поле `theme` при цьому лишається
 *   в API недоторканим.
 * — **Напрямку показу.** Він живе на «Сьогодні»; другий орган керування тим
 *   самим полем — це два місця, де його шукати.
 * — **Цільової памʼятливості.** Сирий 0.7–0.99 — це кнопка «зіпсувати собі
 *   планування», а різниця між 0.90 і 0.91 людині нічого не каже. Діє серверний
 *   `DEFAULT_DESIRED_RETENTION`.
 * — **Вибору часового поясу.** Пояс їде за телефоном сам (`timeZoneNeedsSync`),
 *   і показується тут як рядок, а не як поле: це місце, де видно причину, якщо
 *   календар колись здасться дивним.
 * — **По батькові, статі, телефону, дати народження.** Шаблонні поля профілю з
 *   авторизації; доменного сенсу в застосунку для вивчення слів не мають.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { changePassword, patchProfile, uploadAvatar } from "../api/profile";
import { useAuth } from "../auth/AuthProvider";
import { useOnline } from "../app/useOnline";
import { avatarVersion, markAvatarChanged, prepareAvatar } from "../profile/avatar";
import { AvatarImage } from "../profile/AvatarImage";
import {
  avatarSrc,
  fullName,
  nameChanged,
  nameProblem,
  parseGoal,
} from "../profile/profile";
import { useSettings, useUpdateSettings } from "../study/queries";
import { detectTimeZone } from "../study/day";
import { useVoices } from "../tts/SpeakButton";
import { accentAvailable, speak, speechAvailable, type Accent } from "../tts/speech";
import { SaveButton, Screen } from "../ui/parts";

/**
 * Фраза перевірки.
 *
 * Три слова, у яких американська й британська вимова розходяться найпомітніше
 * (`schedule` — SHED-jool проти SKED-jool). Тому кнопка перевіряє не лише «чи є
 * звук узагалі», а й «чи справді змінився акцент» — на «Hello, this is a test»
 * зі старого PWA другого не чути.
 */
const TEST_PHRASE = "Schedule. Water. Tomato.";

const ACCENTS: { value: Accent; label: string; full: string }[] = [
  { value: "auto", label: "Авто", full: "Англійського" },
  { value: "us", label: "US", full: "Американського" },
  { value: "gb", label: "UK", full: "Британського" },
];

const messageOf = (problem: unknown, fallback: string) =>
  problem instanceof ApiError || problem instanceof Error
    ? problem.message
    : fallback;

export default function ProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const online = useOnline();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  // Імʼя й аватар міг змінити інший пристрій — при вході на екран перечитуємо.
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  return (
    <Screen
      title={fullName(user)}
      /* Профіль — найдовший екран застосунку, і «Вийти» лежало в самому його
         кінці. Тихим воно лишається: прибити не означає підвищити. */
      foot={
        <button className="btn-quiet" type="button" onClick={logout}>
          Вийти
        </button>
      }
    >
      <AvatarBlock />
      <NameBlock key={user?.id ?? 0} />

      <div className="ed-label">Щоденні цілі</div>
      {settings.data ? (
        <GoalsBlock
          newGoal={settings.data.daily_new_goal}
          reviewGoal={settings.data.daily_review_goal}
          disabled={!online || updateSettings.isPending}
          onSave={(payload) => updateSettings.mutateAsync(payload)}
        />
      ) : (
        <div className="hint">Завантаження…</div>
      )}

      <div className="ed-label">Озвучення</div>
      <VoiceBlock />

      <div className="ed-label">Обліковий запис</div>
      <div className="p-row">
        <span className="p-row-key">Часовий пояс</span>
        <span className="p-row-val">
          {settings.data?.timezone ?? detectTimeZone()}
        </span>
      </div>
      <div className="hint">
        Пояс визначається автоматично й змінюється разом із телефоном. Від нього
        залежить, до якої доби потрапить нічне повторення.
      </div>

      <PasswordBlock />
    </Screen>
  );
}

function AvatarBlock() {
  const { user, refreshUser } = useAuth();
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [version, setVersion] = useState(avatarVersion);

  const src = avatarSrc(user?.avatar, version);
  const initial = (user?.first_name || user?.email || "?").trim().charAt(0).toUpperCase();

  const pick = async (file: File | undefined) => {
    if (!file || !user) return;
    setError(null);
    setBusy(true);
    try {
      // Стискаємо ДО відправки: сервер приймає не більше 1 МБ, а знімок із
      // телефона важить кілька.
      await uploadAvatar(user.id, await prepareAvatar(file));
      markAvatarChanged();
      setVersion(avatarVersion());
      await refreshUser();
    } catch (problem) {
      setError(messageOf(problem, "Не вдалось завантажити аватар"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      {/* Плитка впізнання: фото і пошта разом. Окремий рядок «ПОШТА» нижче був
          би другим місцем, де написано те саме. */}
      <div className="p-id">
        {/* Кнопкою є саме фото: окрема «Замінити» поруч із ним казала б те
            саме, що й дотик по ньому, тільки словами. */}
        <button
          className="p-avatar"
          type="button"
          disabled={!online || busy}
          aria-label={src ? "Замінити фото" : "Додати фото"}
          onClick={() => input.current?.click()}
        >
          <AvatarImage src={src} initial={initial} onFail={() => setUnreachable(true)} />
          <span className="p-avatar-hint">{busy ? "…" : "змінити"}</span>
        </button>
        {/* Тут лише пошта. Підпису «натисни на коло» немає — на самому колі
            стоїть «змінити». Кнопки «Прибрати фото» теж немає навмисно: нею
            користуються раз на рік, а висіла б вона завжди. Ендпоінт
            `DELETE /profiles/{id}/avatar/` при цьому лишається живим. */}
        <div className="p-id-main">
          <div className="p-id-mail">{user?.email ?? "—"}</div>
        </div>
        <input
          ref={input}
          className="p-file"
          type="file"
          accept="image/jpeg,image/png"
          onChange={(event) => void pick(event.target.files?.[0])}
        />
      </div>
      {error ? <div className="msg msg-error">{error}</div> : null}
      {/* Файл завантажився, а картинка з нього не приїхала — це не помилка
          користувача, і мовчати про неї не можна: без цього рядка залишається
          враження, що завантаження не спрацювало. Причина завжди одна —
          `S3_STORAGE_PUBLIC_ENDPOINT` на сервері не вказує на публічну адресу. */}
      {unreachable && !error ? (
        <div className="hint">
          Фото збережено, але показати його не вдалось — сховище недоступне з
          цього пристрою.
        </div>
      ) : null}
    </>
  );
}

function NameBlock() {
  const { user, refreshUser } = useAuth();
  const online = useOnline();
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const problem = nameProblem(firstName) ?? nameProblem(lastName);
  const changed = nameChanged(
    { firstName: user?.first_name ?? null, lastName: user?.last_name ?? null },
    { firstName, lastName },
  );

  const save = async () => {
    if (!user || problem) return;
    setError(null);
    setSaving(true);
    try {
      await patchProfile(user.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      await refreshUser();
      setSaved(true);
    } catch (issue) {
      setError(messageOf(issue, "Не вдалось зберегти імʼя"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Секційної мітки тут немає: підписи полів кажуть те саме, а «ІМʼЯ»
          двічі поспіль виглядало б як помилка верстки. Обидва поля в один
          рядок — окремими рядками вони займали б пів екрана під два слова. */}
      <div className="p-pair">
        <div className="field">
          <label htmlFor="first-name">Імʼя</label>
          <input
            id="first-name"
            value={firstName}
            autoComplete="given-name"
            onChange={(event) => {
              setFirstName(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="last-name">Прізвище</label>
          <input
            id="last-name"
            value={lastName}
            autoComplete="family-name"
            onChange={(event) => {
              setLastName(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        {/* Збереження стоїть у тому ж рядку, що й поля: окремим рядком під ними
            кнопка читалась як дія всього екрана, хоча вона стосується рівно
            цих двох полів. */}
        <SaveButton
          onClick={save}
          disabled={!online || saving || !changed || problem !== null}
          state={saving ? "saving" : saved && !changed ? "saved" : "idle"}
        />
      </div>

      {/* Правило бекенду, а не наша примха: `validate_name` приймає лише
          українські літери. Кажемо про це до збереження, а не після 422. */}
      {problem ? <div className="msg msg-error">{problem}</div> : null}
      {error ? <div className="msg msg-error">{error}</div> : null}
    </>
  );
}

function GoalsBlock({
  newGoal,
  reviewGoal,
  disabled,
  onSave,
}: {
  newGoal: number;
  reviewGoal: number;
  disabled: boolean;
  onSave: (payload: {
    daily_new_goal: number;
    daily_review_goal: number;
  }) => Promise<unknown>;
}) {
  const [nextNew, setNextNew] = useState(String(newGoal));
  const [nextReview, setNextReview] = useState(String(reviewGoal));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsedNew = parseGoal(nextNew);
  const parsedReview = parseGoal(nextReview);
  const valid = parsedNew !== null && parsedReview !== null;
  const changed = parsedNew !== newGoal || parsedReview !== reviewGoal;

  const save = async () => {
    if (!valid) return;
    setError(null);
    try {
      await onSave({ daily_new_goal: parsedNew, daily_review_goal: parsedReview });
      setSaved(true);
    } catch (problem) {
      setError(messageOf(problem, "Не вдалось зберегти цілі"));
    }
  };

  return (
    <>
      <div className="p-pair">
        <div className="field">
          <label htmlFor="goal-new">Нових слів</label>
          <input
            id="goal-new"
            inputMode="numeric"
            value={nextNew}
            onChange={(event) => {
              setNextNew(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="goal-review">Повторень</label>
          <input
            id="goal-review"
            inputMode="numeric"
            value={nextReview}
            onChange={(event) => {
              setNextReview(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <SaveButton
          onClick={save}
          disabled={disabled || !valid || !changed}
          state={saved && !changed ? "saved" : "idle"}
        />
      </div>

      {/* Ціль — орієнтир, а не обмеження: застосунок ніколи не ховає картки,
          яким настав час. Нуль вимикає ціль. */}
      <div className="hint">
        Нуль вимикає ціль. Прострочені картки показуються завжди — ціль їх не
        обмежує.
      </div>

      {!valid ? (
        <div className="msg msg-error">Ціль — ціле число від 0 до 1000.</div>
      ) : null}
      {error ? <div className="msg msg-error">{error}</div> : null}
    </>
  );
}

/**
 * Озвучення.
 *
 * Це єдине місце, де ним керують: вимикача в навчанні свідомо немає, щоб стан
 * не мав двох різних джерел. Плата видима — прибрати звук посеред сесії коштує
 * виходу з навчання.
 *
 * Три стани пристрою розрізняються навмисно, і плутати їх не можна:
 *
 *   немає API      — озвучення неможливе, показуємо, що робити;
 *   голоси невідомі — `getVoices()` ще порожній, і стверджувати про акценти
 *                     нема підстав, тож нічого не гасимо;
 *   голоси відомі   — акцент без голосу гасне, бо три кнопки, з яких дві дають
 *                     один і той самий голос, — інтерфейс, що бреше.
 */
function VoiceBlock() {
  const online = useOnline();
  const settings = useSettings();
  const update = useUpdateSettings();
  const { voices, ready } = useVoices();

  if (!speechAvailable) {
    return (
      <div className="hint">
        Цей браузер не вміє озвучувати. На Android голос дає застосунок «Google
        Синтез мовлення» з англомовним пакетом; на iPhone він уже вбудований.
      </div>
    );
  }

  const data = settings.data;
  if (!data) return <div className="hint">Завантаження…</div>;

  const locked = !online || update.isPending;
  const noEnglish = ready && !accentAvailable(voices, "auto");
  const missing = (accent: Accent) => ready && !accentAvailable(voices, accent);

  return (
    <>
      <div className="tts">
        {/* Мікрорубрики над цим рядком немає навмисно: «Озвучення» стоїть
            секційною міткою одразу над блоком, і другий підпис поспіль
            читається як помилка верстки. */}
        <div className="tts-group">
          <div className="tts-opts">
            <Opt
              on={data.tts_enabled}
              disabled={locked}
              onClick={() => update.mutate({ tts_enabled: true })}
            >
              Увімкнено
            </Opt>
            <Opt
              on={!data.tts_enabled}
              disabled={locked}
              onClick={() => update.mutate({ tts_enabled: false })}
            >
              Вимкнено
            </Opt>
          </div>
        </div>

        {/* Вимкнене озвучення ховає решту цілком: темп і акцент голосу, якого
            не буде, — це органи керування нічим. */}
        {data.tts_enabled ? (
          <>
            <div className="tts-group">
              <div className="tts-key">у навчанні</div>
              <div className="tts-opts">
                <Opt
                  on={data.tts_autoplay}
                  disabled={locked}
                  onClick={() => update.mutate({ tts_autoplay: true })}
                >
                  Автоматично
                </Opt>
                <Opt
                  on={!data.tts_autoplay}
                  disabled={locked}
                  onClick={() => update.mutate({ tts_autoplay: false })}
                >
                  Лише вручну
                </Opt>
              </div>
            </div>

            <div className="tts-group">
              <div className="tts-key">акцент</div>
              <div className="tts-opts">
                {ACCENTS.map((accent) => (
                  <Opt
                    key={accent.value}
                    on={data.tts_accent === accent.value}
                    disabled={locked || missing(accent.value)}
                    title={
                      missing(accent.value)
                        ? `${accent.full} голосу на цьому пристрої немає`
                        : undefined
                    }
                    onClick={() => update.mutate({ tts_accent: accent.value })}
                  >
                    {accent.label}
                  </Opt>
                ))}
              </div>
            </div>

            <div className="tts-group">
              <div className="tts-key">темп</div>
              <div className="tts-opts">
                <Opt
                  on={!data.tts_slow}
                  disabled={locked}
                  onClick={() => update.mutate({ tts_slow: false })}
                >
                  Звичайний
                </Opt>
                <Opt
                  on={data.tts_slow}
                  disabled={locked}
                  onClick={() => update.mutate({ tts_slow: true })}
                >
                  Повільний
                </Opt>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {data.tts_enabled ? (
        <>
          <button
            className="btn-quiet"
            type="button"
            onClick={() =>
              void speak(TEST_PHRASE, { accent: data.tts_accent, slow: data.tts_slow })
            }
          >
            Перевірити голос
          </button>
          {/* Не випадкові слова: саме на них чути різницю між US і UK, тож
              перевірка заразом показує, чи справді змінився акцент. */}
          <div className="hint">Прозвучить: «{TEST_PHRASE}»</div>
        </>
      ) : null}

      {noEnglish ? (
        <div className="hint">
          Англійських голосів на цьому пристрої не знайшлось. Слова
          озвучуватимуться тим, що є, а голос доставляється в налаштуваннях
          системи.
        </div>
      ) : null}

      {!online ? <div className="hint">Змінити озвучення можна лише зі звʼязком.</div> : null}
    </>
  );
}

/** Кнопка вибору. Той самий чип, що й у виборі напрямку на «Сьогодні». */
function Opt({
  on,
  disabled,
  title,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={on ? "chip chip-on" : "chip"}
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PasswordBlock() {
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setDone(true);
      setOpen(false);
    } catch (problem) {
      setError(messageOf(problem, "Не вдалось змінити пароль"));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <>
        <button
          className="btn-quiet"
          type="button"
          disabled={!online}
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
        >
          Змінити пароль
        </button>
        {done ? <div className="hint">Пароль змінено.</div> : null}
      </>
    );
  }

  return (
    <div className="ed-panel">
      <div className="field">
        <label htmlFor="pwd-current">Поточний пароль</label>
        <input
          id="pwd-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="pwd-next">Новий пароль</label>
        <input
          id="pwd-next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </div>

      {error ? <div className="msg msg-error">{error}</div> : null}

      <button
        className="btn"
        type="button"
        disabled={!online || busy || !current || !next}
        onClick={submit}
      >
        {busy ? "Зміна…" : "Змінити пароль"}
      </button>
      <button
        className="btn-quiet"
        type="button"
        style={{ marginTop: 8 }}
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
      >
        Скасувати
      </button>
    </div>
  );
}
