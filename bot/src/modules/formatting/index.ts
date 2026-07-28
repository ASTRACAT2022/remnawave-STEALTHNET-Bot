/**
 * STEALTHNET — Formatting utilities
 *
 * Centralized formatting for money, dates, durations, traffic, and progress bars.
 * All display formatting goes through this module for consistency.
 */

// ─── Currency ───

const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: "₽", USD: "$", UAH: "₴", EUR: "€",
};

/** Get currency symbol from ISO code */
export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code.toUpperCase();
}

/** Format money amount: "1 234 ₽" */
export function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount);
  return `${rounded} ${currencySymbol(currency)}`;
}

/** Format money with strikethrough (for discount display) */
export function formatMoneyStrikethrough(amount: number, currency: string): string {
  const sym = currencySymbol(currency);
  return `~~${Math.round(amount)} ${sym}~~`;
}

// ─── Date & Time ───

/** Format date as DD.MM.YYYY */
export function formatDate(date: Date | number): string {
  const d = typeof date === "number" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Format datetime as DD.MM.YYYY HH:MM */
export function formatDateTime(date: Date | number): string {
  const d = typeof date === "number" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Format remaining days: "5 дн." / "1 дн." / "0 дн." */
export function formatDaysLeft(days: number): string {
  return `${days} ${pluralizeDays(days)}`;
}

/** Russian pluralization for "день" */
export function pluralizeDays(n: number): string {
  const abs = Math.abs(n);
  const lastTwo = abs % 100;
  const last = abs % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

/** Format duration in days: "30 дн." */
export function formatDuration(days: number): string {
  return `${days} ${pluralizeDays(days)}`;
}

// ─── Traffic ───

/** Bytes to GB with 2 decimal places */
export function bytesToGb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

/** Format traffic: "1.50 / 10.00 ГБ" */
export function formatTraffic(usedBytes: number, limitBytes: number): string {
  return `${bytesToGb(usedBytes)} / ${bytesToGb(limitBytes)} ГБ`;
}

/** Progress percentage: "45%" */
export function trafficPercent(usedBytes: number, limitBytes: number): string {
  if (limitBytes <= 0) return "0%";
  return `${Math.round(Math.min(100, (usedBytes / limitBytes) * 100))}%`;
}

// ─── Progress Bar ───

/** Visual progress bar: "████████░░░░░░" */
export function progressBar(pct: number, barLen: number = 14): string {
  const filled = Math.round(Math.max(0, Math.min(1, pct)) * barLen);
  return "█".repeat(filled) + "░".repeat(barLen - filled);
}

// ─── Status ───

export type SubscriptionStatus = "ACTIVE" | "EXPIRED" | "LIMITED" | "DISABLED" | "INACTIVE";

/** Status to emoji mapping */
export function statusEmoji(status: SubscriptionStatus): { big: string; small: string } {
  switch (status) {
    case "ACTIVE":   return { big: "🟢", small: "✅" };
    case "EXPIRED":  return { big: "🔴", small: "❌" };
    case "LIMITED":  return { big: "🟡", small: "🟡" };
    case "DISABLED": return { big: "🔴", small: "❌" };
    default:         return { big: "🟡", small: "🟡" };
  }
}

/** Status to localized label */
export function statusLabel(status: SubscriptionStatus, lang: string = "ru"): string {
  if (lang === "ru") {
    switch (status) {
      case "ACTIVE":   return "Активна";
      case "EXPIRED":  return "Истекла";
      case "LIMITED":  return "Ограничена";
      case "DISABLED": return "Отключена";
      default:         return "Неизвестно";
    }
  }
  switch (status) {
    case "ACTIVE":   return "Active";
    case "EXPIRED":  return "Expired";
    case "LIMITED":  return "Limited";
    case "DISABLED": return "Disabled";
    default:         return "Unknown";
  }
}

// ─── Truncation ───

/** Truncate text to maxLen with ellipsis */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

/** Truncate for Telegram button labels (max 64 bytes in callback, but label can be longer) */
export function buttonLabel(text: string, maxLen: number = 64): string {
  return truncate(text, maxLen);
}

// ─── Phone / HWID sanitization ───

/** Clean user-provided strings for safe Telegram button text (remove control chars, fix surrogates) */
export function sanitizeLabel(s: string): string {
  return Array.from(Buffer.from(String(s ?? ""), "utf8").toString("utf8"))
    .filter((c) => c >= " ")
    .join("");
}

// ─── i18n helpers ───

/** Pluralize days based on language */
export function formatDays(n: number, lang: string = "ru"): string {
  if (lang !== "ru") {
    return `${n} ${n === 1 ? "day" : "days"}`;
  }
  return `${n} ${pluralizeDays(n)}`;
}

/** Parse ExpireAt from various Remnawave formats */
export function parseExpireAt(raw: unknown): Date | null {
  if (raw == null) return null;
  let d: Date;
  if (typeof raw === "number") {
    d = new Date(raw * 1000);
  } else {
    d = new Date(String(raw));
  }
  return isNaN(d.getTime()) ? null : d;
}

/** Calculate days remaining from now to a date */
export function daysUntil(date: Date | number): number | null {
  const d = typeof date === "number" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.max(0, Math.ceil(diff / 86_400_000));
}
