import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, OfflineError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { peekShare, pendingSharePath } from "../sharing/pending";
import { Field, Message, Screen } from "../ui/parts";

export default function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Людина могла прийти за посиланням на список. Тоді причину, чому в неї просять
   * пароль, треба назвати: сам список ми показати не можемо (перегляд шеру
   * вимагає логіну), тож текст безіменний — але він відповідає на питання «а це
   * взагалі те, що я відкрив?».
   */
  const awaitingShare = peekShare() !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      // Тільки читаємо: забере токен той екран, який доїхав (див. pending.ts).
      navigate(pendingSharePath() ?? "/", { replace: true });
    } catch (caught) {
      // Повідомлення називає, що робити далі, а не переказує код відповіді.
      if (caught instanceof OfflineError) {
        setError("Немає звʼязку. Увійти можна тільки онлайн.");
      } else if (caught instanceof ApiError && caught.code === "account_not_activated") {
        setError("Акаунт ще не активовано. Відкрий посилання з листа.");
      } else if (caught instanceof ApiError && caught.status === 401) {
        setError("Пошта або пароль не підходять.");
      } else {
        setError(caught instanceof Error ? caught.message : "Щось пішло не так");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen eyebrow="slovnuk" title="Вхід">
      <p className="hint" style={{ marginTop: 10 }}>
        {awaitingShare
          ? "Щоб узяти список слів, увійдіть або створіть акаунт — після цього ми відкриємо його самі."
          : "Слова й прогрес зберігаються на сервері, тож для входу потрібен звʼязок."}
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
          placeholder="ivan@example.com"
          required
        />
        <Field
          label="Пароль"
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="btn" type="submit" disabled={busy || !email || !password}>
          {busy ? "Заходимо…" : "Увійти"}
        </button>
      </form>

      <div className="login-links">
        <Link className="btn-link" to="/accounts/register">
          Створити акаунт
        </Link>
        <Link className="btn-link" to="/accounts/forgot-password">
          Забув пароль
        </Link>
      </div>
    </Screen>
  );
}
