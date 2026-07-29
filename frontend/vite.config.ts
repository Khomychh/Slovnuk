import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Проксі на бекенд у розробці робить те саме, що Caddy у продакшені: фронтенд
// і API живуть на одному origin. Без нього тут був би CORS, якого в продакшені
// немає — тобто розробка перевіряла б не ту конфігурацію (ADR-0008).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Slovnuk",
        short_name: "Slovnuk",
        description: "Англійські слова за методом інтервальних повторень",
        lang: "uk",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        // Обидва дорівнюють --night і theme-color в index.html. background_color —
        // це екран запуску встановленого застосунку: розійшовшись із тлом, він
        // дає спалах чужого кольору перед першим кадром. Тут лишався #14100D зі
        // старої коричневої палітри, до ADR-0012.
        background_color: "#070a14",
        theme_color: "#070a14",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Оболонка кешується, API — ні. Офлайн-черга навчання зі своїми
        // правилами приходить у блоці 2 (ADR-0007); мовчазне кешування
        // відповідей API до того часу означало б показувати вчорашній словник
        // і не знати про це.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Порт із docker-compose (BACKEND_PORT за замовчуванням 8000).
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
