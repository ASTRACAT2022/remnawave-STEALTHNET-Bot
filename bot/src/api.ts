/**
 * STEALTHNET 3.0 — API клиент бота (вызовы бэкенда).
 */

const API_URL = (process.env.API_URL || "").replace(/\/$/, "");
const BOT_INTERNAL_API_KEY = (process.env.BOT_INTERNAL_API_KEY || "").trim();
const PUBLIC_CONFIG_CACHE_MS = 5000;
const API_RETRY_ATTEMPTS = 4;
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

async function fetchJson<T>(path: string, opts?: { method?: string; body?: unknown; token?: string; extraHeaders?: Record<string, string> }): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= API_RETRY_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method: opts?.method ?? "GET",
        headers: { ...getHeaders(opts?.token), ...(opts?.extraHeaders ?? {}) },
        ...(opts?.body !== undefined && { body: JSON.stringify(opts.body) }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = new Error(`NetworkError: API недоступен (${msg})`);
      if (attempt < API_RETRY_ATTEMPTS) {
        await sleep(200 * attempt);
        continue;
      }
      throw lastErr;
    }

    const data = (await res.json().catch(() => ({}))) as T | { message?: string };
    if (res.ok) {
      return data as T;
    }

    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    if (res.status === 429 && attempt < API_RETRY_ATTEMPTS) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      await sleep(retryAfterMs ?? 300 * attempt);
      continue;
    }

    lastErr = new Error(msg);
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
}): Promise<{ token: string; client: { id: string; telegramUsername?: string | null; preferredCurrency: string; balance: number; trialUsed?: boolean; referralCode?: string | null } }> {
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
}> {
  return fetchJson("/api/client/auth/me", { token });
}

/** Подписка Remna (для ссылки VPN, статус, трафик) + отображаемое имя тарифа с сайта */
export async function getSubscription(token: string): Promise<{ subscription: unknown; tariffDisplayName?: string | null; message?: string }> {
  return fetchJson("/api/client/subscription", { token });
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
