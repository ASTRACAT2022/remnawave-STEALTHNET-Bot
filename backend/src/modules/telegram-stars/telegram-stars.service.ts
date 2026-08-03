/**
 * Telegram Stars (XTR) оплата.
 *
 * Платежи Telegram Stars работают через Telegram Bot API:
 *   - createInvoiceLink(currency="XTR", prices=[{label, amount}]) → возвращает
 *     ссылку https://t.me/$<slug>, которую открывают в Telegram
 *     (в Mini App через WebApp.openInvoice).
 *   - Бот получает pre_checkout_query (нужно ответить ok) и
 *     message:successful_payment (payload = наш paymentId) — бот затем подтверждает
 *     оплату через backend, который вызывает markPaymentPaid (активация тарифа/Wdtt/..).
 *
 * Количество Stars — целое число (без копеек). Цена в Stars считается как
 * ceil(fiat / курс), где курс (telegramStarsRateRub) задаёт админ: сколько ₽ в 1 Star.
 */

import { telegramApiUrl } from "../telegram/telegram-api-root.js";

const BOT_TOKEN = (process.env.BOT_TOKEN ?? "").trim();

export type CreateStarsInvoiceResult =
  | { ok: true; invoiceUrl: string }
  | { ok: false; error: string };

export async function createTelegramStarsInvoice(params: {
  paymentId: string;
  title: string;
  description: string;
  starsCount: number;
  currency: string;
}): Promise<CreateStarsInvoiceResult> {
  if (!BOT_TOKEN) return { ok: false, error: "BOT_TOKEN не задан в окружении" };
  if (!Number.isInteger(params.starsCount) || params.starsCount < 1) {
    return { ok: false, error: "Некорректное количество Stars" };
  }
  const res = await fetch(telegramApiUrl(BOT_TOKEN, "createInvoiceLink"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: params.title,
      description: params.description,
      payload: params.paymentId,
      provider_token: "", // для Stars XTR пустой токен обязателен.
      currency: "XTR",
      prices: [{ label: "Оплата через Telegram Stars", amount: params.starsCount }],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: string;
    description?: string;
  };
  if (!res.ok || !data.ok || !data.result) {
    return { ok: false, error: data.description || (data.ok === false ? `Telegram API: ${data.description ?? "ошибка"}` : `Telegram API HTTP ${res.status}`) };
  }
  return { ok: true, invoiceUrl: data.result };
}