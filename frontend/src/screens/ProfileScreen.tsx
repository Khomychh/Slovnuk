/**
 * Профіль: імʼя, аватар, денні цілі, озвучення, вигляд, обліковий запис.
 *
 * ЕКРАН ГОВОРИТЬ ПАНЕЛЯМИ — так само, як редактор картки. До цього він був
 * пласким потоком, у якому секції розділяв лише капітельний підпис, і два
 * найдовші екрани застосунку були збудовані по-різному без жодної причини.
 *
 * Кожна преференція показана рівно одним органом:
 *
 *   булеве          — перемикач у рядку («Озвучення», «Повільніше»);
 *   два-три названі — сегментована доріжка («Акцент», «Тема»).
 *
 * Ряду чипів більше немає ніде. Пара чипів коштувала двох рядків — рубрики над
 * ними й самої пари — і показувала обидві відповіді там, де питання одне.
 *
 * Чого тут немає і чому:
 *
 * — **Перевірки голосу.** Кнопка на всю ширину плюс рядок «Прозвучить: …» —
 *   90 пікселів екрана на «послухати три слова», причому тією самою вагою, що
 *   й «Вийти». Акцент перевіряється в живому слові: динамік стоїть на картці.
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

import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { changePassword, patchProfile, uploadAvatar } from "../api/profile";
import { useAuth } from "../auth/AuthProvider";
import { useOnline } from "../app/useOnline";
import { readThemePreference, storeThemePreference, type ThemePreference } from "../app/theme";
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
import { accentAvailable, speechAvailable, type Accent } from "../tts/speech";
import { OpenIcon, SaveButton, Screen, Segmented, Switch } from "../ui/parts";

const ACCENTS: { value: Accent; label: string; full: string }[] = [
  { value: "auto", label: "Авто", full: "Англійського" },
  { value: "us", label: "US", full: "Американського" },
  { value: "gb", label: "UK", full: "Британського" },
];

/** Підписи теми. «Системна» перша: вона ж і початкове значення на сервері. */
const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Системна" },
  { value: "light", label: "Світла" },
  { value: "dark", label: "Темна" },
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
      <IdentityBlock key={user?.id ?? 0} />

      <div className="ed-label">Щоденні цілі</div>
      {settings.data ? (
        <GoalsBlock
          newGoal={settings.data.daily_new_goal}
          reviewGoal={settings.data.daily_review_goal}
          disabled={!online || updateSettings.isPending}
          onSave={(payload) => updateSettings.mutateAsync(payload)}
        />
      ) : (
        <div className="p-note">Завантаження…</div>
      )}

      <div className="ed-label">Озвучення</div>
      <VoiceBlock />

      <div className="ed-label">Вигляд</div>
      <ThemeBlock />

      <div className="ed-label">Обліковий запис</div>
      <AccountBlock timezone={settings.data?.timezone ?? detectTimeZone()} />
    </Screen>
  );
}

/**
 * Плитка впізнання: фото, пошта й імʼя одним предметом.
 *
 * Аватар і імʼя були двома блоками поспіль, і це читалось як дві теми там, де
 * тема одна — «хто я». Злиття прибрало з екрана цілий шов.
 *
 * Кільце сяйва навколо фото — ціла рампа, тобто підпис застосунку (ADR-0025),
 * а не значення: воно однакове в кожного користувача й нічого не міряє. Це
 * четвертий його масштаб після картки, кнопки «Вчити» й героя «Прогресу».
 *
 * Розмита стрічка над верхнім краєм плитки тут БУЛА і знята. На панелі 200px
 * заввишки вона перестає бути сяйвом над обрієм і стає градієнтним банером на
 * пів плитки — тим самим, якого мільйон, — а пошта опиняється написаною по
 * веселці. Кільце дає той самий підпис на 68 пікселях і нічого не заливає.
 */
function IdentityBlock() {
  const { user, refreshUser } = useAuth();
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [version, setVersion] = useState(avatarVersion);

  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const problem = nameProblem(firstName) ?? nameProblem(lastName);
  const changed = nameChanged(
    { firstName: user?.first_name ?? null, lastName: user?.last_name ?? null },
    { firstName, lastName },
  );

  const saveName = async () => {
    if (!user || problem) return;
    setNameError(null);
    setSaving(true);
    try {
      await patchProfile(user.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      await refreshUser();
      setSaved(true);
    } catch (issue) {
      setNameError(messageOf(issue, "Не вдалось зберегти імʼя"));
    } finally {
      setSaving(false);
    }
  };

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
      <div className="p-id">
        <div className="p-id-top">
          {/* Кнопкою є саме фото: окрема «Замінити» поруч із ним казала б те
              саме, що й дотик по ньому, тільки словами. Кільце сяйва навколо —
              оправа, а не ореол: тінь-сяйво тут була б четвертим видом тіні. */}
          <span className="p-ring">
            <button
              className="p-avatar"
              type="button"
              disabled={!online || busy}
              aria-label={src ? "Замінити фото" : "Додати фото"}
              onClick={() => input.current?.click()}
            >
              <AvatarImage
                src={src}
                initial={initial}
                onFail={() => setUnreachable(true)}
              />
              <span className="p-avatar-hint">{busy ? "…" : "змінити"}</span>
            </button>
          </span>
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

        {/* Підписи полів кажуть, що це імʼя, тож секційної мітки над ними
            немає. Обидва поля в один рядок — окремими рядками вони займали б
            пів плитки під два слова. Збереження стоїть у тому ж рядку: окремим
            рядком під ними кнопка читалась як дія всього екрана. */}
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
          <SaveButton
            onClick={saveName}
            disabled={!online || saving || !changed || problem !== null}
            state={saving ? "saving" : saved && !changed ? "saved" : "idle"}
          />
        </div>
      </div>

      {/* Правило бекенду, а не наша примха: `validate_name` приймає лише
          українські літери. Кажемо про це до збереження, а не після 422. */}
      {problem ? <div className="msg msg-error">{problem}</div> : null}
      {nameError ? <div className="msg msg-error">{nameError}</div> : null}
      {error ? <div className="msg msg-error">{error}</div> : null}
      {/* Файл завантажився, а картинка з нього не приїхала — це не помилка
          користувача, і мовчати про неї не можна: без цього рядка залишається
          враження, що завантаження не спрацювало. Причина завжди одна —
          `S3_STORAGE_PUBLIC_ENDPOINT` на сервері не вказує на публічну адресу. */}
      {unreachable && !error ? (
        <div className="p-note">
          Фото збережено, але показати його не вдалось — сховище недоступне з
          цього пристрою.
        </div>
      ) : null}
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
      <div className="p-card p-card-fields">
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
      </div>

      {/* Ціль — орієнтир, а не обмеження: застосунок ніколи не ховає картки,
          яким настав час. Нуль вимикає ціль. */}
      <div className="p-note">
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
      <div className="p-note">
        Цей браузер не вміє озвучувати. На Android голос дає застосунок «Google
        Синтез мовлення» з англомовним пакетом; на iPhone він уже вбудований.
      </div>
    );
  }

  const data = settings.data;
  if (!data) return <div className="p-note">Завантаження…</div>;

  const locked = !online || update.isPending;
  const noEnglish = ready && !accentAvailable(voices, "auto");
  const missing = (accent: Accent) => ready && !accentAvailable(voices, accent);

  return (
    <>
      <div className="p-card">
        {/* Підпис перемикача називає УВІМКНЕНИЙ стан, а не тему налаштування:
            «Озвучення» з вимкненим перемикачем читається однозначно, а «Темп»
            із вимкненим — ні. Через це «Звичайний / Повільний» стало
            «Повільніше», а «Автоматично / Лише вручну» — «Промовляти саме». */}
        <Switch
          label="Озвучення"
          on={data.tts_enabled}
          disabled={locked}
          onChange={(on) => update.mutate({ tts_enabled: on })}
        />

        {/* Вимкнене озвучення ховає решту цілком: темп і акцент голосу, якого
            не буде, — це органи керування нічим. */}
        {data.tts_enabled ? (
          <>
            <Switch
              label="Промовляти саме"
              hint="У навчанні слово звучить без дотику"
              on={data.tts_autoplay}
              disabled={locked}
              onChange={(on) => update.mutate({ tts_autoplay: on })}
            />
            <Switch
              label="Повільніше"
              on={data.tts_slow}
              disabled={locked}
              onChange={(on) => update.mutate({ tts_slow: on })}
            />
            <div className="p-line">
              <span className="p-line-key">Акцент</span>
              <Segmented
                label="Акцент"
                value={data.tts_accent}
                disabled={locked}
                options={ACCENTS.map((accent) => ({
                  value: accent.value,
                  label: accent.label,
                  disabled: missing(accent.value),
                  title: missing(accent.value)
                    ? `${accent.full} голосу на цьому пристрої немає`
                    : undefined,
                }))}
                onChange={(value) => update.mutate({ tts_accent: value })}
              />
            </div>
          </>
        ) : null}
      </div>

      {noEnglish ? (
        <div className="p-note">
          Англійських голосів на цьому пристрої не знайшлось. Слова
          озвучуватимуться тим, що є, а голос доставляється в налаштуваннях
          системи.
        </div>
      ) : null}

      {!online ? (
        <div className="p-note">Змінити озвучення можна лише зі звʼязком.</div>
      ) : null}
    </>
  );
}

/**
 * Вигляд: тема оформлення.
 *
 * Пишеться у ДВА місця, і обидва обовʼязкові. `storeThemePreference` малює
 * негайно й кладе копію в `localStorage` заради першого кадру наступного
 * запуску; `update.mutate` везе вибір на сервер, щоб він доїхав на інший
 * пристрій. Мережі при цьому може не бути — і тоді тема все одно змінилась,
 * бо перше з двох записів локальне. Це навмисно: вигляд не та річ, заради якої
 * варто чекати на звʼязок.
 */
function ThemeBlock() {
  const online = useOnline();
  const update = useUpdateSettings();
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);

  return (
    <>
      <div className="p-card">
        {/* Підпис над доріжкою, а не поруч: «Системна · Світла · Темна» —
            двадцять символів, і в рядок із підписом вони не стають на жодному
            телефоні. Акцент («Авто · US · UK») стає, тому там рядок. */}
        <div className="p-line p-line-stack">
          <span className="p-line-key">Тема</span>
          <Segmented
            label="Тема"
            value={theme}
            options={THEMES}
            onChange={(value) => {
              setTheme(value);
              storeThemePreference(value);
              if (online) update.mutate({ theme: value });
            }}
          />
        </div>
      </div>
      {!online ? (
        <div className="p-note">
          Без звʼязку тема змінюється лише на цьому пристрої.
        </div>
      ) : null}
    </>
  );
}

/**
 * Обліковий запис: пояс і пароль однією панеллю.
 *
 * Пояс тут рядком, а не полем: він їде за телефоном сам (`timeZoneNeedsSync`),
 * і показаний рівно для того, щоб було де побачити причину, якщо календар
 * колись здасться дивним.
 */
function AccountBlock({ timezone }: { timezone: string }) {
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

  return (
    <>
      <div className="p-card">
        <div className="p-line">
          <span className="p-line-key">Часовий пояс</span>
          <span className="p-line-val">{timezone}</span>
        </div>
        {/* Зміна пароля — рядок панелі, а не кнопка під нею: до неї доходять
            раз на рік, і власна кнопка на всю ширину важила б стільки ж, що
            «Вийти». */}
        <button
          className="p-act"
          type="button"
          disabled={!online || open}
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
        >
          <span>Змінити пароль</span>
          <OpenIcon />
        </button>
      </div>

      <div className="p-note">
        Пояс визначається автоматично й змінюється разом із телефоном. Від нього
        залежить, до якої доби потрапить нічне повторення.
      </div>

      {done ? <div className="p-note">Пароль змінено.</div> : null}

      {open ? (
        <div className="p-card p-card-fields">
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
            style={{ margin: "8px 0 14px" }}
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            Скасувати
          </button>
        </div>
      ) : null}
    </>
  );
}
