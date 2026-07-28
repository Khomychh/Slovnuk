import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import ActivateScreen from "../screens/ActivateScreen";
import LoginScreen from "../screens/LoginScreen";
import {
  ForgotPasswordScreen,
  ResetPasswordScreen,
} from "../screens/PasswordScreens";
import {
  GrammarScreen,
  ProfileScreen,
  TodayScreen,
  VocabularyScreen,
} from "../screens/Stubs";
import TabsLayout from "./TabsLayout";

/**
 * Захищена частина.
 *
 * Поки статус «loading», не показуємо ні застосунок, ні логін: інакше при
 * кожному запуску встигав би блимнути екран входу, навіть коли токен на місці.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <div className="screen" aria-busy="true" />;
  if (status === "anonymous") return <Navigate to="/accounts/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { status } = useAuth();

  return (
    <div className="shell">
      <Routes>
        {/* Адреси листів зафіксовані бекендом — не перейменовувати наодинці. */}
        <Route path="/accounts/activate" element={<ActivateScreen />} />
        <Route
          path="/accounts/reset-password/complete"
          element={<ResetPasswordScreen />}
        />
        <Route path="/accounts/forgot-password" element={<ForgotPasswordScreen />} />
        <Route
          path="/accounts/login"
          element={
            status === "authenticated" ? <Navigate to="/" replace /> : <LoginScreen />
          }
        />

        <Route
          element={
            <RequireAuth>
              <TabsLayout />
            </RequireAuth>
          }
        >
          <Route index element={<TodayScreen />} />
          <Route path="/vocabulary" element={<VocabularyScreen />} />
          <Route path="/grammar" element={<GrammarScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
