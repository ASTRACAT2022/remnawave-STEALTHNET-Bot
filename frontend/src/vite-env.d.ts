/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/info" />

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        close: () => void;
        /** Платформа клиента Telegram: ios, android, android_x, macos, web, weba, tdesktop, unigram и др. */
        platform?: string;
        showPopup?: (params: { title?: string; message?: string }) => void;
        /** Открыть ссылку во внешнем браузере (кастомные URL-схемы не поддерживаются, только https) */
        openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
        /** Открыть счёт Telegram Stars (нативный платёжный оверлей Telegram). Доступен только в Mini App. */
        openInvoice?: (url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending" | string) => void) => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        themeParams?: Record<string, string>;
      };
    };
  }
}
export {};
