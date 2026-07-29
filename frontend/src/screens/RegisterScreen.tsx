/**
 * Реєстрація.
 *
 * Була відсутня цілком: ендпоінт на бекенді є з першого дня, а маршруту й
 * посилання з екрана входу — ні. Поки користувач один, це не помічалось; щойно
 * з'явився шер, вона стала обов'язковою — людина, якій дали посилання на список,
 * інакше не має жодного способу завести акаунт.
 *
 * Полів рівно два: `UserRegistrationRequestSchema` — це email і пароль, більше
 * бекенд не приймає. Ім'я заповнюється потім у профілі.
 *
 * Другого поля «повторіть пароль» немає навмисно: пошта однаково перевіряється
 * листом активації, тож помилка в паролі лікується скиданням, а не блокує
 * акаунт. Замість нього — перемикач «показати», який ту саму помилку показує
 * одразу.
 */

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, OfflineError, apiFetch } from "../api/client";
import {
  PASSWORD_HINT,
  emailLooksWrong,
  normalizeEmail,
  passwordProblem,
} from "../auth/password";
import { peekShare } from "../sharing/pending";
import { Field, Message, Screen } from "../ui/parts";

export default function RegisterScreen() {
  const navigate = useNavigate();
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
        setError(caught instanceof Error ? caught.message : "Щось пішло не так");
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen eyebrow="slovnuk" title="Перевірте пошту">
        <p className="hint" style={{ marginTop: 10 }}>
          Ми надіслали лист на {normalizeEmail(email)}. Відкрийте посилання з
          нього — воно активує акаунт. Доки цього не зробите, увійти не вийде.
        </p>
        {awaitingShare ? (
          <p className="hint">
            Список, за яким ви прийшли, не втрачено: він відкриється після входу.
          </p>
        ) : null}
        <button
          className="btn"
          type="button"
          onClick={() => navigate("/accounts/login", { replace: true })}
        >
          До входу
        </button>
      </Screen>
    );
  }

  return (
    <Screen eyebrow="slovnuk" title="Реєстрація">
      <p className="hint" style={{ marginTop: 10 }}>
        {awaitingShare
          ? "Щоб узяти список слів, потрібен акаунт. Після реєстрації ми відкриємо його самі."
          : "Слова й прогрес зберігаються на сервері, тож потрібен акаунт."}
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
        <div className="reg-row">
          <span className="hint">{PASSWORD_HINT}</span>
          <button
            className="btn-link"
            type="button"
            onClick={() => setShow((current) => !current)}
          >
            {show ? "Сховати" : "Показати"}
          </button>
        </div>

        <button className="btn" type="submit" disabled={busy || !email || !password}>
          {busy ? "Створюємо…" : "Створити акаунт"}
        </button>
      </form>

      <div style={{ marginTop: 18, textAlign: "center" }}>
        <Link className="btn-link" to="/accounts/login">
          Уже маю акаунт
        </Link>
      </div>
    </Screen>
  );
}
