/**
 * FreeKassa API integration (JSON API, not SCI).
 *
 * API docs:
 *   - all requests: https://api.fk.life/v1/
 *   - request signature: sort request keys alphabetically, join values with "|",
 *     HMAC-SHA256 with API key
 *   - create order: POST /orders/create, response.location is the payment URL
 *   - webhook: form-data + MD5(MERCHANT_ID:AMOUNT:secret2:MERCHANT_ORDER_ID)
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const FREEKASSA_API_BASE = "https://api.fk.life/v1";

export const FREEKASSA_PAYMENT_SYSTEMS = {
  qiwi: 35,
  cardRub: 36,
  sbp: 44,
} as const;

export const FREEKASSA_ALLOWED_WEBHOOK_IPS = new Set([
  "168.119.157.136",
  "168.119.60.227",
  "178.154.197.79",
  "51.250.54.238",
]);

export type FreekassaConfig = {
  shopId: string;
  apiKey: string;
  secretWord2: string;
};

export type FreekassaPaymentMethod = keyof typeof FREEKASSA_PAYMENT_SYSTEMS;

export function isFreekassaConfigured(config: Pick<FreekassaConfig, "shopId" | "apiKey"> | null): boolean {
  return Boolean(config?.shopId?.trim() && config?.apiKey?.trim());
}

export function normalizeFreekassaPaymentSystem(method: FreekassaPaymentMethod | number | undefined): number {
  if (typeof method === "number" && Number.isInteger(method) && method > 0) return method;
  if (typeof method === "string" && method in FREEKASSA_PAYMENT_SYSTEMS) return FREEKASSA_PAYMENT_SYSTEMS[method];
  return FREEKASSA_PAYMENT_SYSTEMS.sbp;
}

export type CreateFreekassaOrderParams = {
  config: Pick<FreekassaConfig, "shopId" | "apiKey">;
  amount: number;
  currency: string;
  paymentId: string;
  paymentSystemId: number;
  email: string;
  ip: string;
  successUrl?: string;
  failureUrl?: string;
  notificationUrl?: string;
  tel?: string;
};

export type CreateFreekassaOrderResult =
  | { ok: true; orderId: number; orderHash: string; location: string }
  | { ok: false; error: string; status?: number };

export type FreekassaOrderStatusResult =
  | { ok: true; paid: boolean; status: number | null; order: Record<string, unknown> | null }
  | { ok: false; error: string; status?: number };

export async function createFreekassaOrder(params: CreateFreekassaOrderParams): Promise<CreateFreekassaOrderResult> {
  const shopId = params.config.shopId?.trim();
  const apiKey = params.config.apiKey?.trim();
  if (!shopId || !apiKey) return { ok: false, error: "FreeKassa не настроена" };

  const amount = Math.round(params.amount * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: `FreeKassa: некорректная сумма (${params.amount})` };
  }
  if (!params.email.trim()) return { ok: false, error: "FreeKassa: email покупателя обязателен" };
  if (!params.ip.trim() || params.ip === "127.0.0.1" || params.ip === "::1") {
    return { ok: false, error: "FreeKassa: нужен реальный IP покупателя, 127.0.0.1 блокируется" };
  }

  const payload: Record<string, string | number> = {
    shopId: Number(shopId),
    nonce: makeNonce(),
    paymentId: params.paymentId,
    i: params.paymentSystemId,
    email: params.email.trim(),
    ip: params.ip.trim(),
    amount: amount.toFixed(2),
    currency: params.currency.toUpperCase(),
  };
  if (params.tel?.trim()) payload.tel = params.tel.trim();
  if (params.successUrl?.trim()) payload.success_url = params.successUrl.trim();
  if (params.failureUrl?.trim()) payload.failure_url = params.failureUrl.trim();
  if (params.notificationUrl?.trim()) payload.notification_url = params.notificationUrl.trim();
  payload.signature = signFreekassaApiRequest(payload, apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(`${FREEKASSA_API_BASE}/orders/create`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, proxy);
    clearTimeout(timeoutId);

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { ok: false, error: `FreeKassa: не JSON (HTTP ${res.status})`, status: res.status };
    }

    if (!res.ok || data.type !== "success") {
      const msg = extractFreekassaError(data) ?? (text.slice(0, 300) || `HTTP ${res.status}`);
      return { ok: false, error: `FreeKassa: ${msg}`, status: res.status };
    }

    const location = typeof data.location === "string" ? data.location.trim() : "";
    const orderHash = typeof data.orderHash === "string" ? data.orderHash.trim() : "";
    const orderId = typeof data.orderId === "number" ? data.orderId : Number(data.orderId);
    if (!location || !Number.isFinite(orderId)) {
      return { ok: false, error: "FreeKassa не вернула ссылку на оплату", status: res.status };
    }

    return { ok: true, orderId, orderHash, location };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("ETIMEDOUT") || (e instanceof Error && e.name === "AbortError")) {
      return { ok: false, error: "Нет связи с FreeKassa. Проверьте интернет и настройки прокси." };
    }
    return { ok: false, error: message };
  }
}

export async function getFreekassaOrderStatus(params: {
  config: Pick<FreekassaConfig, "shopId" | "apiKey">;
  orderId?: string | number | null;
  paymentId?: string | null;
}): Promise<FreekassaOrderStatusResult> {
  const shopId = params.config.shopId?.trim();
  const apiKey = params.config.apiKey?.trim();
  if (!shopId || !apiKey) return { ok: false, error: "FreeKassa не настроена" };

  const payload: Record<string, string | number> = {
    shopId: Number(shopId),
    nonce: makeNonce(),
  };
  const orderId = params.orderId != null ? String(params.orderId).trim() : "";
  if (orderId && /^\d+$/.test(orderId)) payload.orderId = Number(orderId);
  const paymentId = params.paymentId?.trim();
  if (paymentId) payload.paymentId = paymentId;
  payload.signature = signFreekassaApiRequest(payload, apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(`${FREEKASSA_API_BASE}/orders`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, proxy);
    clearTimeout(timeoutId);

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { ok: false, error: `FreeKassa: не JSON (HTTP ${res.status})`, status: res.status };
    }

    if (!res.ok || data.type !== "success") {
      const msg = extractFreekassaError(data) ?? (text.slice(0, 300) || `HTTP ${res.status}`);
      return { ok: false, error: `FreeKassa: ${msg}`, status: res.status };
    }

    const order = pickFreekassaOrder(data, { orderId, paymentId });
    const rawStatus = order ? (order.status ?? order.orderStatus ?? order.order_status) : null;
    const statusValue = Number(rawStatus);
    const status = Number.isFinite(statusValue) ? statusValue : null;
    const paid = status === 1 || String(rawStatus ?? "").trim().toLowerCase() === "paid";
    return { ok: true, paid, status, order };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("ETIMEDOUT") || (e instanceof Error && e.name === "AbortError")) {
      return { ok: false, error: "Нет связи с FreeKassa. Проверьте интернет и настройки прокси." };
    }
    return { ok: false, error: message };
  }
}

export function signFreekassaApiRequest(payload: Record<string, string | number>, apiKey: string): string {
  const values = Object.entries(payload)
    .filter(([key]) => key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => String(value));
  return createHmac("sha256", apiKey).update(values.join("|")).digest("hex");
}

export function signFreekassaWebhook(merchantId: string, amount: string, secretWord2: string, merchantOrderId: string): string {
  return createHash("md5").update(`${merchantId}:${amount}:${secretWord2}:${merchantOrderId}`).digest("hex");
}

export function verifyFreekassaWebhookSignature(params: {
  merchantId: string;
  amount: string;
  secretWord2: string;
  merchantOrderId: string;
  signature: string;
}): boolean {
  const expected = signFreekassaWebhook(
    params.merchantId,
    params.amount,
    params.secretWord2,
    params.merchantOrderId,
  );
  const got = params.signature.trim().toLowerCase();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(got, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function isFreekassaWebhookIPAllowed(ip: string | undefined | null): boolean {
  const normalized = normalizeIP(ip);
  return Boolean(normalized && FREEKASSA_ALLOWED_WEBHOOK_IPS.has(normalized));
}

function makeNonce(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function normalizeIP(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const clean = ip.trim().replace(/^::ffff:/, "");
  if (!clean) return null;
  if (clean.includes(":") && clean.includes(".")) return clean.split(":").pop() ?? clean;
  return clean;
}

function extractFreekassaError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.message === "string" && d.message.trim()) return d.message.trim();
  if (typeof d.error === "string" && d.error.trim()) return d.error.trim();
  if (typeof d.desc === "string" && d.desc.trim()) return d.desc.trim();
  if (Array.isArray(d.errors) && typeof d.errors[0] === "string") return d.errors[0];
  return null;
}

function pickFreekassaOrder(
  data: Record<string, unknown>,
  ids: { orderId: string; paymentId?: string },
): Record<string, unknown> | null {
  const orders = Array.isArray(data.orders) ? data.orders : (Array.isArray(data.data) ? data.data : []);
  const normalizedOrderId = ids.orderId.trim();
  const normalizedPaymentId = ids.paymentId?.trim() ?? "";
  for (const item of orders) {
    if (!item || typeof item !== "object") continue;
    const order = item as Record<string, unknown>;
    const fkOrderId = String(order.fk_order_id ?? order.orderId ?? order.order_id ?? order.id ?? "").trim();
    const merchantOrderId = String(order.merchant_order_id ?? order.paymentId ?? order.payment_id ?? "").trim();
    if (normalizedOrderId && fkOrderId === normalizedOrderId) return order;
    if (normalizedPaymentId && merchantOrderId === normalizedPaymentId) return order;
  }
  if (orders.length === 1 && orders[0] && typeof orders[0] === "object") return orders[0] as Record<string, unknown>;
  return null;
}
