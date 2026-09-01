/**
 * Скидання пароля — два екрани.
 *
 * Адреса другого зафіксована бекендом:
 * {FRONTEND_BASE_URL}/accounts/reset-password/complete?email=…&token=…
 *
 * Обидва звуться так само, як посилання, що на них веде («Скинути пароль»,
 * «Новий пароль»): дія мусить мати одне ім'я по всьому шляху.
 */

import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch, OfflineError } from "../api/client";
import { PASSWORD_HINT, passwordProblem } from "../auth/password";
import { AuthScreen, Field, Message, SaveIcon } from "../ui/parts";

/**
 * Помилка людською мовою.
 *
 * `caught.message` сюди не потрапляє навмисно: бекенд кладе в нього
 * англійський рядок («Invalid email or token.»), і показувати його — те саме,
 * що не показувати нічого.
 */
function describe(caught: unknown, fallback: string): string {
  if (caught instanceof OfflineError) return "Немає звʼязку. Спробуйте пізніше.";
  if (caught instanceof ApiError && caught.code === "invalid_reset_token") {
    return "Посилання застаріло або вже спрацювало. Попросіть нове.";
  }
  return fallback;
}

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/accounts/password-reset/request/", {
        method: "POST",
        anonymous: true,
        body: { email: email.trim() },
      });
      setSent(true);
    } catch (caught) {
      setError(describe(caught, "Не вдалося надіслати лист."));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthScreen title="Перевірте пошту">
        {/* Бекенд навмисно відповідає однаково на відому й невідому пошту —
            інакше форма підказувала б, які акаунти існують. Текст мусить це
            витримувати: він не обіцяє, що лист точно прийшов. */}
        <p className="hint auth-note">
          Якщо такий акаунт існує, лист із посиланням уже в дорозі.
        </p>
        <Link className="btn-quiet auth-act" to="/accounts/login">
          До входу
        </Link>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Скинути пароль">
      <p className="hint auth-note">
        Надішлемо посилання, яким ви задасте новий пароль.
      </p>
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
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ivan@example.com"
          required
        />
        <button className="btn" type="submit" disabled={busy || !email}>
          {busy ? "Надсилаємо…" : "Надіслати посилання"}
        </button>
      </form>
    </AuthScreen>
  );
}

export function ResetPasswordScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const email = params.get("email") ?? "";
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // Та сама локальна перевірка, що в новому акаунті. Доти цей екран єдиний
    // відправляв пароль наосліп і чекав, поки сервер поскаржиться, — а вимоги
    // під полем при цьому переказував по-своєму й без слова «латинські».
    const weak = passwordProblem(password);
    if (weak) {
      setError(weak);
      return;
    }

    setBusy(true);
    try {
      await apiFetch("/accounts/reset-password/complete/", {
        method: "POST",
        anonymous: true,
        body: { email, token, password },
      });
      navigate("/accounts/login", { replace: true });
    } catch (caught) {
      setError(describe(caught, "Не вдалося змінити пароль."));
    } finally {
      setBusy(false);
    }
  }

  if (!email || !token) {
    return (
      <AuthScreen title="Посилання не спрацювало">
        <Message kind="error">
          Посилання неповне. Відкрийте його з листа цілком.
        </Message>
        {/* Вихід звідси був відсутній: екран лишав людину з плашкою й нічим.
            Нове посилання просять на тому самому екрані, що й перше. */}
        <Link className="btn-quiet auth-act" to="/accounts/forgot-password">
          Скинути пароль
        </Link>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Новий пароль">
      <p className="hint auth-note">Для {email}.</p>
      {error ? <Message kind="error">{error}</Message> : null}
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          label="Пароль"
          id="password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="none"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        {/* Тут кнопка лишається на всю ширину з підписом: це головна дія цілого
            екрана, а не куток панелі. Іконка та сама, що й у решті збережень. */}
        <button className="btn btn-with-icon" type="submit" disabled={busy || !password}>
          <SaveIcon />
          {busy ? "Зберігаємо…" : "Зберегти пароль"}
        </button>
      </form>
    </AuthScreen>
  );
}
