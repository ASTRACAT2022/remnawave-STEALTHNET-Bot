/**
 * Shared Telegram API root URL — reads from TELEGRAM_API_URL env var.
 * All Telegram Bot API calls MUST use this instead of hardcoding
 * https://api.telegram.org.
 */

const raw = process.env.TELEGRAM_API_URL;
if (!raw?.trim()) {
  throw new Error(
    "TELEGRAM_API_URL environment variable is required but not set. " +
    "Set it to your Telegram API root (e.g. https://api.telegram.org)."
  );
}

export const TELEGRAM_API_ROOT: string = raw.trim().replace(/\/+$/, "");

export function telegramApiUrl(token: string, method: string): string {
  return `${TELEGRAM_API_ROOT}/bot${token}/${method}`;
}
