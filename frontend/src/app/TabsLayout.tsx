/**
 * Каркас із чотирма вкладками: Сьогодні · Словник · Граматика · Профіль.
 *
 * «Навчання» вкладкою НЕ є і сюди не додається — це повноекранний режим, у
 * якому панель вкладок ховається, щоб палець не вилітав із навчання повз кнопку
 * оцінки. Приходить у блоці 2.
 */

import { NavLink, Outlet } from "react-router-dom";
import { useOnline } from "../app/useOnline";

const TABS = [
  {
    to: "/",
    label: "Сьогодні",
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </>
    ),
  },
  {
    to: "/vocabulary",
    label: "Словник",
    icon: (
      <>
        <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" />
        <path d="M8 8h7M8 12h7" />
      </>
    ),
  },
  {
    to: "/grammar",
    label: "Граматика",
    icon: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
        <path d="M4 5.5v15" />
      </>
    ),
  },
  {
    to: "/profile",
    label: "Профіль",
    icon: (
      <>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5" />
      </>
    ),
  },
];

export default function TabsLayout() {
  const online = useOnline();

  return (
    <>
      {online ? null : (
        <div className="offline-bar" role="status">
          Офлайн — показуємо збережене
        </div>
      )}

      <Outlet />

      <nav className="tabs">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === "/"}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              {tab.icon}
            </svg>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
