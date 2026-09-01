/**
 * Новий акаунт.
 *
 * Полів рівно два: `UserRegistrationRequestSchema` — це email і пароль, більше
 * бекенд не приймає. Ім'я заповнюється потім у профілі.
 *
 * Другого поля «повторіть пароль» немає навмисно: пошта однаково перевіряється
 * листом активації, тож помилка в паролі лікується скиданням, а не блокує
 * акаунт. Замість нього — перемикач «Показати», який ту саму помилку показує
 * одразу. Те саме рішення діє й на екрані нового пароля.
 *
 * Пояснення «слова й прогрес зберігаються на сервері, тож потрібен акаунт»
 * прибрано: воно доводило потребу в акаунті людині, яка вже натиснула
 * «Створити акаунт».
 *
 * Той самий екран — і спосіб отримати новий лист активації: пошта, зайнята
 * непідтвердженим акаунтом, вільна, і реєстрація починає його наново
 * (ADR-0034). Тому `email_already_exists` тепер означає рівно одне — акаунт
 * живий і підтверджений, тож порада «спробуйте увійти» завжди правдива.
 */

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, OfflineError, apiFetch } from "../api/client";
import {
  PASSWORD_HINT,
  emailLooksWrong,
  normalizeEmail,
  passwordProblem,
} from "../auth/password";
import { peekShare } from "../sharing/pending";
import { AuthScreen, Field, Message } from "../ui/parts";

export default function RegisterScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  // Людина могла прийти за посиланням на список — тоді варто сказати, що вона
  // його не втратила: після входу застосунок сам відкриє той список.
  const awaitingShare = peekShare() !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // Локальна перевірка дзеркалить серверну, щоб та сама вимога не приходила
    // п'ятьма запитами по одній.
    if (emailLooksWrong(email)) {
      setError("Перевірте пошту: схоже, адреса неповна.");
      return;
    }
    const weak = passwordProblem(password);
    if (weak) {
      setError(weak);
      return;
    }

    setBusy(true);
    try {
      await apiFetch("/accounts/register/", {
        method: "POST",
        anonymous: true,
        body: { email: normalizeEmail(email), password },
      });
      setSent(true);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError("Немає звʼязку. Зареєструватись можна тільки онлайн.");
      } else if (
        caught instanceof ApiError &&
        caught.code === "email_already_exists"
      ) {
        setError("Акаунт із такою поштою вже є. Спробуйте увійти.");
      } else {
        setError("Не вдалося створити акаунт. Спробуйте ще раз.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    /* Заголовок і є повідомленням, тому окремої плашки під ним немає. Рядок
       нижче каже рівно дві невідомі речі: куди пішов лист і що з ним робити.
       Третє речення — «доки цього не зробите, увійти не вийде» — прибрано: це
       та сама думка вдруге, і вона однаково прозвучить на вході, якщо людина
       туди прийде без активації. */
    return (
      <AuthScreen title="Перевірте пошту">
        <p className="hint auth-note">
          Лист із посиланням пішов на {normalizeEmail(email)}. Відкрийте
          посилання — воно активує акаунт.
        </p>
        <Link className="btn auth-act" to="/accounts/login" replace>
          До входу
        </Link>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Новий акаунт">
      {awaitingShare ? (
        <p className="hint auth-note">
          Список, яким з вами поділились, відкриється одразу після входу.
        </p>
      ) : null}

      {error ? <Message kind="error">{error}</Message> : null}

      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          label="Пошта"
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="ivan@example.com"
          required
        />
        <Field
          label="Пароль"
          id="password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="none"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button
          className="btn-link auth-pw-toggle"
          type="button"
          onClick={() => setShow((current) => !current)}
        >
          {show ? "Сховати" : "Показати"}
        </button>
        <p className="hint auth-pw-note">{PASSWORD_HINT}</p>

        <button className="btn" type="submit" disabled={busy || !email || !password}>
          {busy ? "Створюємо…" : "Створити акаунт"}
        </button>
      </form>

      <div className="auth-links">
        <Link className="btn-link" to="/accounts/login">
          Уже маю акаунт
        </Link>
      </div>
    </AuthScreen>
  );
}
