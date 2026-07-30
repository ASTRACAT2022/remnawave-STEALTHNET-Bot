import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n/init";
import App from "./App";
import "./index.css";

// Одноразовая смена эпохи PWA после замены WDTT на OlcRTC. Очищаем только
// Cache Storage и регистрацию корневого Service Worker, не трогая токены,
// тему и другие пользовательские настройки в localStorage.
const CACHE_RESET_EPOCH = "olcrtc-links-20260730";
const CACHE_RESET_KEY = "stealthnet_pwa_cache_epoch";

async function resetLegacyPwaCache(): Promise<void> {
  if (localStorage.getItem(CACHE_RESET_KEY) === CACHE_RESET_EPOCH) return;

  try {
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }

    if ("serviceWorker" in navigator) {
      const rootScope = `${window.location.origin}/`;
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => registration.scope === rootScope)
          .map((registration) => registration.unregister()),
      );
    }

    localStorage.setItem(CACHE_RESET_KEY, CACHE_RESET_EPOCH);
  } catch (error) {
    // Не мешаем открытию кабинета: сброс будет повторён при следующем запуске.
    console.warn("[PWA] Failed to reset legacy cache:", error);
  }
}

async function bootstrap(): Promise<void> {
  await resetLegacyPwaCache();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
