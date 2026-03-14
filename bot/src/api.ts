/**
 * STEALTHNET 3.0 — API клиент бота (вызовы бэкенда).
 */

const API_URL = (process.env.API_URL || "").replace(/\/$/, "");
const BOT_INTERNAL_API_KEY = (process.env.BOT_INTERNAL_API_KEY || "").trim();
const PUBLIC_CONFIG_CACHE_MS = 5000;
const BROADCAST_ADMINS_CACHE_MS = 5000;
const API_RETRY_ATTEMPTS = 4;
const API_RETRY_BASE_MS = 300;
if (!API_URL) {
  console.warn("API_URL not set in .env — bot API calls will fail");
}

function getHeaders(token?: string): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (BOT_INTERNAL_API_KEY) h["X-Bot-Internal-Key"] = BOT_INTERNAL_API_KEY;
  return h;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const sec = Number(value);
  if (Number.isFinite(sec) && sec > 0) {
    return Math.max(250, Math.floor(sec * 1000));
  }
  const when = Date.parse(value);
  if (Number.isFinite(when)) {
    const ms = when - Date.now();
    if (ms > 0) return Math.max(250, ms);
  }
  return null;
}

function isRetryableMethod(method: string, retryableOverride?: boolean): boolean {
  if (retryableOverride) return true;
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function normalizeHttpError(status: number, message: string): string {
  const lower = message.toLowerCase();
  if (status === 502 || lower.includes("bad gateway")) {
    return "Сервер временно недоступен (502 Bad Gateway). Попробуйте снова через 1–2 минуты.";
  }
  if (status === 503 || lower.includes("service unavailable")) {
    return "Сервис временно недоступен (503). Попробуйте снова через 1–2 минуты.";
  }
  if (status === 504 || lower.includes("gateway timeout")) {
    return "Сервер не ответил вовремя (504 Gateway Timeout). Попробуйте позже.";
  }
  return message;
}

export class ApiRequestError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.data = data;
  }
}

async function fetchJson<T>(path: string, opts?: { method?: string; body?: unknown; token?: string; extraHeaders?: Record<string, string>; retryable?: boolean }): Promise<T> {
  let lastErr: Error | null = null;
  const method = (opts?.method ?? "GET").toUpperCase();
  const canRetry = isRetryableMethod(method, opts?.retryable);
  for (let attempt = 1; attempt <= API_RETRY_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { ...getHeaders(opts?.token), ...(opts?.extraHeaders ?? {}) },
        ...(opts?.body !== undefined && { body: JSON.stringify(opts.body) }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = new Error(`NetworkError: API недоступен (${msg})`);
      if (attempt < API_RETRY_ATTEMPTS && canRetry) {
        await sleep(API_RETRY_BASE_MS * attempt);
        continue;
      }
      throw lastErr;
    }

    const data = (await res.json().catch(() => ({}))) as T | { message?: string };
    if (res.ok) {
      return data as T;
    }

    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    if (attempt < API_RETRY_ATTEMPTS && canRetry && isRetryableStatus(res.status)) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      await sleep(retryAfterMs ?? API_RETRY_BASE_MS * attempt);
      continue;
    }

    lastErr = new ApiRequestError(res.status, normalizeHttpError(res.status, msg), data);
    break;
  }

  throw lastErr ?? new Error("API request failed");
}

export type PublicConfig = {
  serviceName?: string | null;
  logo?: string | null;
  publicAppUrl?: string | null;
  defaultCurrency?: string;
  trialEnabled?: boolean;
  trialDays?: number;
  plategaMethods?: { id: number; label: string }[];
  yoomoneyEnabled?: boolean;
  yookassaEnabled?: boolean;
  yookassaSbpEnabled?: boolean;
  telegramStarsEnabled?: boolean;
  botButtons?: { id: string; visible: boolean; label: string; order: number; style?: string; iconCustomEmojiId?: string }[] | null;
  /** Тексты меню с уже подставленными эмодзи ({{BALANCE}} → unicode из bot_emojis) */
  resolvedBotMenuTexts?: Record<string, string>;
  /** Для каких ключей текста меню в начале стоит премиум-эмодзи: key → custom_emoji_id (для entities) */
  menuTextCustomEmojiIds?: Record<string, string>;
  /** Эмодзи по ключам: unicode и tgEmojiId (премиум) — для кнопок и подстановки в текст */
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }>;
  botBackLabel?: string | null;
  botMenuTexts?: Record<string, string> | null;
  botInnerButtonStyles?: Record<string, string> | null;
  activeLanguages?: string[];
  activeCurrencies?: string[];
  defaultReferralPercent?: number;
  referralPercentLevel2?: number;
  referralPercentLevel3?: number;
  supportLink?: string | null;
  agreementLink?: string | null;
  offerLink?: string | null;
  instructionsLink?: string | null;
  forceSubscribeEnabled?: boolean;
  forceSubscribeChannelId?: string | null;
  forceSubscribeMessage?: string | null;
} | null;

let publicConfigCacheValue: PublicConfig = null;
let publicConfigCacheUntil = 0;
let broadcastAdminsCacheValue: string[] = [];
let broadcastAdminsCacheUntil = 0;

/** Публичный конфиг (тарифы, кнопки, способы оплаты, trial и т.д.) */
export async function getPublicConfig(): Promise<PublicConfig> {
  const now = Date.now();
  if (publicConfigCacheValue && now < publicConfigCacheUntil) {
    return publicConfigCacheValue;
  }
  const next = await fetchJson<PublicConfig>("/api/public/config");
  publicConfigCacheValue = next;
  publicConfigCacheUntil = now + PUBLIC_CONFIG_CACHE_MS;
  return next;
}

/** Регистрация / вход по Telegram */
export async function registerByTelegram(body: {
  telegramId: string;
  telegramUsername?: string;
  preferredLang?: string;
  preferredCurrency?: string;
  referralCode?: string;
}): Promise<{ token: string; client: { id: string; telegramUsername?: string | null; preferredCurrency: string; balance: number; trialUsed?: boolean; referralCode?: string | null; isBlocked?: boolean; blockReason?: string | null } }> {
  return fetchJson("/api/client/auth/register", { method: "POST", body });
}

/** Текущий пользователь */
export async function getMe(token: string): Promise<{
  id: string;
  telegramUsername?: string | null;
  preferredLang: string;
  preferredCurrency: string;
  balance: number;
  referralCode?: string | null;
  referralPercent?: number | null;
  trialUsed?: boolean;
  isBlocked?: boolean;
  blockReason?: string | null;
}> {
  return fetchJson("/api/client/auth/me", { token });
}

/** Основная подписка клиента (FPTN или Remna) + отображаемое имя тарифа */
export async function getSubscription(token: string): Promise<{ subscription: unknown; tariffDisplayName?: string | null; message?: string; source?: "fptn" | "remna" }> {
  return fetchJson("/api/client/subscription", { token });
}

/** Перевыпустить подписку (новая ссылка/ключи, старые деактивируются). */
export async function reissueSubscription(token: string): Promise<{
  message: string;
  subscription: unknown;
  tariffDisplayName?: string | null;
  source?: "fptn" | "remna";
}> {
  return fetchJson("/api/client/subscription/reissue", { method: "POST", body: {}, token, retryable: true });
}

/** Публичный список тарифов по категориям (emoji из админки по коду ordinary/premium) */
export async function getPublicTariffs(): Promise<{
  items: {
    id: string;
    name: string;
    emojiKey: string | null;
    emoji: string;
    tariffs: { id: string; name: string; price: number; currency: string }[];
  }[];
}> {
  return fetchJson("/api/public/tariffs");
}

/** Создать платёж Platega (возвращает paymentUrl) */
export async function createPlategaPayment(
  token: string,
  body: {
    amount: number;
    currency: string;
    paymentMethod: number;
    description?: string;
    tariffId?: string;
  }
): Promise<{ paymentUrl: string; orderId: string; paymentId: string }> {
  return fetchJson("/api/client/payments/platega", { method: "POST", body, token });
}

/** Создать платёж ЮMoney (оплата картой). Для тарифа передать tariffId. */
export async function createYoomoneyPayment(
  token: string,
  body: { amount: number; paymentType: "AC"; tariffId?: string }
): Promise<{ paymentId: string; paymentUrl: string }> {
  return fetchJson("/api/client/yoomoney/create-form-payment", { method: "POST", body, token });
}

/** Создать платёж YooKassa. Для тарифа передать tariffId. */
export async function createYookassaPayment(
  token: string,
  body: { amount: number; currency: "RUB"; paymentMethod?: "bank_card" | "sbp"; description?: string; tariffId?: string }
): Promise<{ paymentId: string; paymentUrl: string | null; providerPaymentId: string }> {
  return fetchJson("/api/client/payments/yookassa", { method: "POST", body, token });
}

/** Создать платёж Telegram Stars (инвойс отправляет бот). */
export async function createTelegramStarsPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; description?: string; promoCode?: string }
): Promise<{
  paymentId: string;
  orderId: string;
  amount: number;
  amountCurrency: string;
  starsAmount: number;
  invoicePayload: string;
  description: string;
  discountApplied: boolean;
}> {
  return fetchJson("/api/client/payments/telegram-stars", { method: "POST", body, token });
}

/** Подтвердить успешную оплату Telegram Stars (вызывается ботом по X-Bot-Internal-Key). */
export async function confirmTelegramStarsPayment(body: {
  paymentId: string;
  telegramUserId: string;
  totalAmount: number;
  telegramPaymentChargeId: string;
  providerPaymentChargeId?: string;
  invoicePayload?: string;
}): Promise<{ paymentId: string; orderId: string; status: string; alreadyProcessed: boolean }> {
  // Idempotent endpoint: safe to retry on transient network/5xx errors.
  return fetchJson("/api/public/telegram-stars/confirm", { method: "POST", body, retryable: true });
}

/** Отвязать HWID-устройство по hash из Telegram-уведомления (вызывается ботом по X-Bot-Internal-Key). */
export async function revokeTelegramHwidByHash(body: {
  telegramUserId: string;
  hwidHash: string;
}): Promise<{ ok: boolean; hwidHash?: string; message?: string }> {
  return fetchJson("/api/public/telegram/hwid/revoke-by-hash", { method: "POST", body, retryable: true });
}

/** Список HWID-устройств пользователя по Telegram ID (внутренний endpoint для бота). */
export async function getTelegramHwidDevices(body: {
  telegramUserId: string;
}): Promise<{
  items: {
    hwidHash: string;
    alias: string | null;
    platform: string | null;
    osVersion: string | null;
    deviceModel: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
}> {
  return fetchJson("/api/public/telegram/hwid/list", { method: "POST", body, retryable: true });
}

/** Установить/очистить имя HWID-устройства по hash (alias="" -> очистить). */
export async function setTelegramHwidAlias(body: {
  telegramUserId: string;
  hwidHash: string;
  alias: string;
}): Promise<{ ok: boolean; hwidHash: string; alias: string | null; message?: string }> {
  return fetchJson("/api/public/telegram/hwid/alias", { method: "POST", body, retryable: true });
}

/** Обновить профиль (язык, валюта) */
export async function updateProfile(
  token: string,
  body: { preferredLang?: string; preferredCurrency?: string }
): Promise<unknown> {
  return fetchJson("/api/client/profile", { method: "PATCH", body, token });
}

/** Активировать триал */
export async function activateTrial(token: string): Promise<{ message: string }> {
  return fetchJson("/api/client/trial", { method: "POST", body: {}, token });
}

/** Оплата тарифа балансом */
export async function payByBalance(token: string, tariffId: string): Promise<{ message: string; paymentId: string; newBalance: number }> {
  return fetchJson("/api/client/payments/balance", { method: "POST", body: { tariffId }, token });
}

/** Активировать промо-ссылку (PromoGroup) */
export async function activatePromo(token: string, code: string): Promise<{ message: string }> {
  return fetchJson("/api/client/promo/activate", { method: "POST", body: { code }, token });
}

/** Проверить промокод (PromoCode — скидка / бесплатные дни) */
export async function checkPromoCode(token: string, code: string): Promise<{ type: string; discountPercent?: number | null; discountFixed?: number | null; durationDays?: number | null; name: string }> {
  return fetchJson("/api/client/promo-code/check", { method: "POST", body: { code }, token });
}

/** Активировать промокод FREE_DAYS */
export async function activatePromoCode(token: string, code: string): Promise<{ message: string }> {
  return fetchJson("/api/client/promo-code/activate", { method: "POST", body: { code }, token });
}

/** Внутренний список telegramId для массовой рассылки (только по BOT_INTERNAL_API_KEY). */
export async function getBroadcastTargets(): Promise<{ items: string[]; count: number }> {
  if (!BOT_INTERNAL_API_KEY) {
    throw new Error("BOT_INTERNAL_API_KEY is not set");
  }
  return fetchJson("/api/public/broadcast-targets", {
    extraHeaders: { "X-Bot-Internal-Key": BOT_INTERNAL_API_KEY },
  });
}

function normalizeTelegramIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .map((v) => String(v).trim())
      .filter((v) => /^\d+$/.test(v)),
  )];
}

/** Список админов рассылки из панели (X-Bot-Internal-Key required). */
export async function getBroadcastAdminIds(): Promise<string[]> {
  if (!BOT_INTERNAL_API_KEY) return [];
  const now = Date.now();
  if (now < broadcastAdminsCacheUntil) {
    return broadcastAdminsCacheValue;
  }
  const res = await fetchJson<{ items?: unknown }>("/api/public/broadcast-admins", {
    extraHeaders: { "X-Bot-Internal-Key": BOT_INTERNAL_API_KEY },
  });
  const ids = normalizeTelegramIds(res.items);
  broadcastAdminsCacheValue = ids;
  broadcastAdminsCacheUntil = now + BROADCAST_ADMINS_CACHE_MS;
  return ids;
}
