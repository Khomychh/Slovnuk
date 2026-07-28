/**
 * Скидання пароля — два екрани.
 *
 * Адреса другого зафіксована бекендом:
 * {FRONTEND_BASE_URL}/accounts/reset-password/complete?email=…&token=…
 */

import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, OfflineError } from "../api/client";
import { Field, Message, Screen } from "../ui/parts";

function describe(caught: unknown, fallback: string): string {
  if (caught instanceof OfflineError) return "Немає звʼязку. Спробуй пізніше.";
  return caught instanceof Error ? caught.message : fallback;
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
      setError(describe(caught, "Не вдалося надіслати лист"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen eyebrow="slovnuk" title="Лист надіслано">
        {/* Бекенд навмисно відповідає однаково на відому й невідому пошту —
            інакше форма підказувала б, які акаунти існують. Текст мусить це
            витримувати: він не обіцяє, що лист точно прийшов. */}
        <Message>
          Якщо такий акаунт існує, лист із посиланням уже в дорозі. Перевір пошту.
        </Message>
        <Link className="btn-quiet" to="/accounts/login" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          До входу
        </Link>
      </Screen>
    );
  }

  return (
    <Screen eyebrow="slovnuk" title="Забув пароль">
      <p className="hint" style={{ marginTop: 10 }}>
        Надішлемо посилання, яким можна задати новий пароль.
      </p>
      {error ? <Message kind="error">{error}</Message> : null}
      <form onSubmit={submit} noValidate>
        <Field
          label="Пошта"
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button className="btn" type="submit" disabled={busy || !email}>
          {busy ? "Надсилаємо…" : "Надіслати посилання"}
        </button>
      </form>
    </Screen>
  );
}

export function ResetPasswordScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const email = params.get("email") ?? "";
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = repeat.length > 0 && password !== repeat;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/accounts/reset-password/complete/", {
        method: "POST",
        anonymous: true,
        body: { email, token, password },
      });
      navigate("/accounts/login", { replace: true });
    } catch (caught) {
      setError(describe(caught, "Не вдалося змінити пароль"));
    } finally {
      setBusy(false);
    }
  }

  if (!email || !token) {
    return (
      <Screen eyebrow="slovnuk" title="Новий пароль">
        <Message kind="error">
          Посилання неповне. Відкрий його з листа цілком.
        </Message>
      </Screen>
    );
  }

  return (
    <Screen eyebrow="slovnuk" title="Новий пароль">
      <p className="hint" style={{ marginTop: 10 }}>
        Для {email}. Потрібні великі й малі літери, цифра і спецсимвол.
      </p>
      {error ? <Message kind="error">{error}</Message> : null}
      <form onSubmit={submit} noValidate>
        <Field
          label="Новий пароль"
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Field
          label="Ще раз"
          id="repeat"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          required
        />
        {mismatch ? <Message kind="error">Паролі не збігаються.</Message> : null}
        <button
          className="btn"
          type="submit"
          disabled={busy || !password || mismatch}
        >
          {busy ? "Зберігаємо…" : "Зберегти пароль"}
        </button>
      </form>
    </Screen>
  );
}
