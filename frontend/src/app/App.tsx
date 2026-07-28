import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  type Location,
} from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import ActivateScreen from "../screens/ActivateScreen";
import CardEditScreen from "../screens/CardEditScreen";
import CardScreen from "../screens/CardScreen";
import ListsScreen from "../screens/ListsScreen";
import LoginScreen from "../screens/LoginScreen";
import {
  ForgotPasswordScreen,
  ResetPasswordScreen,
} from "../screens/PasswordScreens";
import { GrammarScreen, ProfileScreen } from "../screens/Stubs";
import StudyScreen from "../screens/StudyScreen";
import TodayScreen from "../screens/TodayScreen";
import VocabularyScreen from "../screens/VocabularyScreen";
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
  const location = useLocation();

  /**
   * Картка й редактор — справжні маршрути, але поверх списку малюються аркушем.
   *
   * Якщо в history є фонова локація, дерево нижче отримує ЇЇ: список лишається
   * змонтованим, тож не гине позиція скролу (а її там до 13 сторінок по 50), і
   * системне «назад» працює даром. За прямим посиланням фонової локації немає —
   * тоді той самий маршрут малюється на весь екран.
   */
  const background = (location.state as { background?: Location } | null)
    ?.background;

  return (
    <div className="shell">
      <Routes location={background ?? location}>
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

        {/* Навчання — ПОЗА TabsLayout навмисно: панель вкладок під час нього
            ховається, щоб палець не вилітав повз кнопку оцінки. Вийти можна
            лише хрестиком. */}
        <Route
          path="/study"
          element={
            <RequireAuth>
              <StudyScreen />
            </RequireAuth>
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
          <Route path="/vocabulary/lists" element={<ListsScreen />} />
          <Route path="/vocabulary/cards/new" element={<CardEditScreen mode="create" />} />
          <Route path="/vocabulary/cards/:id" element={<CardScreen />} />
          <Route
            path="/vocabulary/cards/:id/edit"
            element={<CardEditScreen mode="edit" />}
          />
          <Route path="/grammar" element={<GrammarScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {background ? (
        <Routes>
          <Route
            element={
              <RequireAuth>
                <div className="sheet-scrim sheet-scrim-route">
                  <div className="sheet sheet-tall">
                    <Outlet />
                  </div>
                </div>
              </RequireAuth>
            }
          >
            <Route
              path="/vocabulary/cards/new"
              element={<CardEditScreen mode="create" />}
            />
            <Route path="/vocabulary/cards/:id" element={<CardScreen />} />
            <Route
              path="/vocabulary/cards/:id/edit"
              element={<CardEditScreen mode="edit" />}
            />
          </Route>
        </Routes>
      ) : null}
    </div>
  );
}
