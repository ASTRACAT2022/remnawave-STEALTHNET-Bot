/**
 * Открывает URL во внешнем браузере, если страница запущена в Telegram Mini App.
 * В обычном браузере делает обычный переход.
 */
export function openExternalLink(url: string): void {
  if (typeof window === "undefined") return;
  const href = String(url || "").trim();
  if (!href) return;

  const tg = window.Telegram?.WebApp;
  if (tg?.openLink) {
    try {
      tg.openLink(href, { try_instant_view: false, try_browser: "external" });
      return;
    } catch {
      // fallback ниже
    }
  }
  const w = window.open(href, "_blank", "noopener,noreferrer");
  if (!w) {
    window.location.href = href;
  }
}
