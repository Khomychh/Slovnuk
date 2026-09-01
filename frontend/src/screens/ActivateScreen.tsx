/**
 * Активація пошти.
 *
 * Адреса зафіксована бекендом: лист будується як
 * {FRONTEND_BASE_URL}/accounts/activate?email=…&token=… (routes/accounts.py).
 * Міняти її можна тільки разом із бекендом — інакше лист веде в нікуди.
 *
 * Заголовок каже наслідок, а не назву процесу: «Акаунт активовано» замість
 * плашки «Пошту підтверджено» під словом «Активація». Це та сама фраза двічі,
 * і друга з них займала цілий блок посеред екрана, який людина бачить секунду.
 *
 * Помилки перекладаються тут, а не показуються як є: `caught.message` — це
 * англійський рядок бекенду («Invalid or expired activation token.»), і
 * єдиний екран, куди він потрапляв, — цей.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch, OfflineError } from "../api/client";
import { AuthScreen, Message } from "../ui/parts";

type State = "working" | "done" | "failed";

const TITLE: Record<State, string> = {
  working: "Активуємо акаунт",
  done: "Акаунт активовано",
  failed: "Посилання не спрацювало",
};

function describe(caught: unknown): string {
  if (caught instanceof OfflineError) {
    return "Немає звʼязку. Відкрийте посилання ще раз, коли зʼявиться інтернет.";
  }
  if (caught instanceof ApiError && caught.code === "invalid_activation_token") {
    return "Посилання застаріло або вже спрацювало.";
  }
  return "Не вдалося активувати акаунт.";
}

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
      setError("Посилання неповне. Відкрийте його з листа цілком.");
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
        // «Акаунт уже активний» — це успіх, а не відмова: єдиний спосіб його
        // отримати означає, що пошту вже підтверджено. Так буває щоразу, коли
        // посилання з листа відкривають удруге або коли його перед тим
        // підвантажив поштовий клієнт.
        if (caught instanceof ApiError && caught.code === "account_already_active") {
          setState("done");
          return;
        }
        setState("failed");
        setError(describe(caught));
      }
    })();
  }, [email, token]);

  return (
    <AuthScreen title={TITLE[state]}>
      {state === "done" ? (
        <Link className="btn auth-act" to="/accounts/login" replace>
          Увійти
        </Link>
      ) : null}

      {state === "failed" ? (
        <>
          <Message kind="error">{error}</Message>
          {/* Дві дії, бо причин теж дві: посилання вже спрацювало раніше
              (тоді треба входити) або протермінувалось (тоді треба новий лист,
              і його дає повторна реєстрація тією ж поштою — ADR-0034). */}
          <p className="hint auth-note">
            Якщо акаунт уже активовано, просто увійдіть. Якщо ні — зареєструйтесь
            тією ж поштою ще раз, і прийде новий лист.
          </p>
          <Link className="btn-quiet auth-act" to="/accounts/login">
            Увійти
          </Link>
          <Link className="btn-quiet auth-act" to="/accounts/register">
            Зареєструватись ще раз
          </Link>
        </>
      ) : null}
    </AuthScreen>
  );
}
