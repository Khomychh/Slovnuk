import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthProvider";
import App from "./app/App";
import "./app/theme.css";
import "./ui/ui.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Застосунок відкривають із заблокованого телефона десятки разів на день;
      // перезапит на кожен фокус означав би постійне смикання мережі.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      // Повторювати запит, що впав через відсутність мережі, немає сенсу:
      // офлайн-поведінка робиться свідомо в блоці 2 (ADR-0007), а не
      // випадковими ретраями.
      retry: 1,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Немає #root — index.html зіпсовано");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
