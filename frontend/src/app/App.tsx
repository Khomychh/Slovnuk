import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  type Location,
} from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { pendingSharePath } from "../sharing/pending";
import ActivateScreen from "../screens/ActivateScreen";
import CardEditScreen from "../screens/CardEditScreen";
import CardScreen from "../screens/CardScreen";
import CategoriesScreen from "../screens/CategoriesScreen";
import GrammarScreen from "../screens/GrammarScreen";
import ListShareScreen from "../screens/ListShareScreen";
import ListsScreen from "../screens/ListsScreen";
import LoginScreen from "../screens/LoginScreen";
import NoteEditScreen from "../screens/NoteEditScreen";
import NoteScreen from "../screens/NoteScreen";
import {
  ForgotPasswordScreen,
  ResetPasswordScreen,
} from "../screens/PasswordScreens";
import ProgressScreen from "../screens/ProgressScreen";
import ProfileScreen from "../screens/ProfileScreen";
import RegisterScreen from "../screens/RegisterScreen";
import ShareImportScreen from "../screens/ShareImportScreen";
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
        {/* Уже залогінений на екрані входу — перекидаємо. Але не завжди на «/»:
            людина могла прийти за посиланням на список, і тоді доїхати мусить
            саме туди. Це перекидання спрацьовує одночасно з тим, що робить сам
            LoginScreen, тож обидва лише ЧИТАЮТЬ токен — інакше перше з'їдало б
            його, а друге їхало в нікуди. */}
        <Route
          path="/accounts/login"
          element={
            status === "authenticated" ? (
              <Navigate to={pendingSharePath() ?? "/"} replace />
            ) : (
              <LoginScreen />
            )
          }
        />
        <Route
          path="/accounts/register"
          element={
            status === "authenticated" ? (
              <Navigate to={pendingSharePath() ?? "/"} replace />
            ) : (
              <RegisterScreen />
            )
          }
        />

        {/* Чужий список за посиланням — ПОЗА RequireAuth навмисно. Екран сам
            вирішує, що робити з анонімом: спершу запам'ятати токен, і лише потім
            відправити на вхід. Через RequireAuth токен губився б, бо той робить
            Navigate із replace, не лишаючи по собі адреси. */}
        <Route path="/shares/:token" element={<ShareImportScreen />} />

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
          <Route path="/vocabulary/lists/:id/share" element={<ListShareScreen />} />
          <Route path="/vocabulary/cards/new" element={<CardEditScreen mode="create" />} />
          <Route path="/vocabulary/cards/:id" element={<CardScreen />} />
          <Route
            path="/vocabulary/cards/:id/edit"
            element={<CardEditScreen mode="edit" />}
          />
          <Route path="/grammar" element={<GrammarScreen />} />
          <Route path="/grammar/categories" element={<CategoriesScreen />} />
          <Route path="/grammar/notes/new" element={<NoteEditScreen mode="create" />} />
          <Route path="/grammar/notes/:id" element={<NoteScreen />} />
          <Route
            path="/grammar/notes/:id/edit"
            element={<NoteEditScreen mode="edit" />}
          />
          <Route path="/progress" element={<ProgressScreen />} />
          {/* Профіль лишається справжнім маршрутом, але вкладки в нього немає:
              заходять сюди через аватар на «Сьогодні». */}
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
            <Route
              path="/grammar/notes/new"
              element={<NoteEditScreen mode="create" />}
            />
            <Route path="/grammar/notes/:id" element={<NoteScreen />} />
            <Route
              path="/grammar/notes/:id/edit"
              element={<NoteEditScreen mode="edit" />}
            />
          </Route>
        </Routes>
      ) : null}
    </div>
  );
}
