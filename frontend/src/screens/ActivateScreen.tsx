/**
 * Активація пошти.
 *
 * Адреса зафіксована бекендом: лист будується як
 * {FRONTEND_BASE_URL}/accounts/activate?email=…&token=… (routes/accounts.py).
 * Міняти її можна тільки разом із бекендом — інакше лист веде в нікуди.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch, OfflineError } from "../api/client";
import { Message, Screen } from "../ui/parts";

type State = "working" | "done" | "failed";

export default function ActivateScreen() {
  const [params] = useSearchParams();
  const email = params.get("email");
  const token = params.get("token");

  const [state, setState] = useState<State>("working");
  const [error, setError] = useState<string | null>(null);
  // React у режимі розробки монтує компонент двічі, а активація одноразова:
  // другий виклик отримав би «токен уже використано» і показав помилку на
  // успішному шляху.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    if (!email || !token) {
      setState("failed");
      setError("Посилання неповне. Відкрий його з листа цілком.");
      return;
    }

    void (async () => {
      try {
        await apiFetch("/accounts/activate/", {
          method: "POST",
          anonymous: true,
          body: { email, token },
        });
        setState("done");
      } catch (caught) {
        setState("failed");
        setError(
          caught instanceof OfflineError
            ? "Немає звʼязку. Спробуй ще раз, коли зʼявиться інтернет."
            : caught instanceof Error
              ? caught.message
              : "Не вдалося активувати акаунт",
        );
      }
    })();
  }, [email, token]);

  return (
    <Screen eyebrow="slovnuk" title="Активація">
      {state === "working" ? <p className="hint">Перевіряємо посилання…</p> : null}

      {state === "done" ? (
        <>
          <Message>Пошту підтверджено. Тепер можна увійти.</Message>
          <Link className="btn" to="/accounts/login" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
            Увійти
          </Link>
        </>
      ) : null}

      {state === "failed" ? (
        <>
          <Message kind="error">{error}</Message>
          <p className="hint">
            Посилання діє обмежений час. Якщо воно застаріло, спробуй зареєструватись
            ще раз — прийде новий лист.
          </p>
          <Link className="btn-quiet" to="/accounts/login" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
            До входу
          </Link>
        </>
      ) : null}
    </Screen>
  );
}
