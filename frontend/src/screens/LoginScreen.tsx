/**
 * Вхід.
 *
 * Пояснень тут немає навмисно. Стояло «Слова й прогрес зберігаються на
 * сервері, тож для входу потрібен звʼязок» — абзац про будову застосунку,
 * показаний людині, яка прийшла набрати пошту й пароль. Коли звʼязку справді
 * немає, це каже смуга офлайну зверху й помилка під заголовком, тобто рівно
 * тоді, коли воно щось означає (ADR-0022).
 */

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, OfflineError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { peekShare, pendingSharePath } from "../sharing/pending";
import { AuthScreen, Field, Message } from "../ui/parts";

export default function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Людина могла прийти за посиланням на список. Тоді причину, чому в неї
   * просять пароль, треба назвати: сам список ми показати не можемо (перегляд
   * шеру вимагає логіну), тож текст безіменний — але він відповідає на питання
   * «а це взагалі те, що я відкрив?». Це єдиний рядок, який тут заробив місце.
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
        // Друге речення — для того, у кого лист протермінувався: посилання
        // живе добу, а повторна реєстрація тією ж поштою шле новий (ADR-0034).
        setError(
          "Акаунт ще не активовано. Відкрийте посилання з листа, " +
            "а якщо воно застаріло — створіть акаунт тією ж поштою ще раз.",
        );
      } else if (caught instanceof ApiError && caught.status === 401) {
        setError("Пошта або пароль не підходять.");
      } else {
        setError("Не вдалося увійти. Спробуйте ще раз.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen title="Slovnuk">
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
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
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

      <div className="auth-links">
        <Link className="btn-link" to="/accounts/register">
          Створити акаунт
        </Link>
        {/* Той самий підпис, що й заголовок екрана, куди веде: дія мусить
            зватись однаково по всьому шляху. */}
        <Link className="btn-link" to="/accounts/forgot-password">
          Скинути пароль
        </Link>
      </div>
    </AuthScreen>
  );
}
