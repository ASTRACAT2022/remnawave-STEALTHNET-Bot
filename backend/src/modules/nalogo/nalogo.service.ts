/**
 * Минимальная интеграция с API "Мой Налог" (NaloGO):
 * - авторизация по ИНН/паролю
 * - создание чека о доходе
 *
 * Основано на рабочей логике из remnawave-bedolaga-telegram-bot-main.
 */

import { randomBytes } from "crypto";

const NALOGO_BASE = "https://lknpd.nalog.ru/api";
const NALOGO_DEVICE_SOURCE_TYPE = "WEB";
const NALOGO_APP_VERSION = "1.0.0";
const NALOGO_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_2) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/88.0.4324.192 Safari/537.36";

export type NalogoConfig = {
  enabled: boolean;
  inn?: string | null;
  password?: string | null;
  deviceId?: string | null;
  timeoutSeconds?: number;
};

export type NalogoCreateReceiptResult =
  | { receiptUuid: string }
  | { error: string; status: number; retryable: boolean };

function defaultHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": NALOGO_USER_AGENT,
    Referrer: "https://lknpd.nalog.ru/auth/login",
  };
}

function resolveTimeoutMs(config: NalogoConfig): number {
  const timeoutSec =
    Number.isFinite(config.timeoutSeconds) && Number(config.timeoutSeconds) > 0
      ? Number(config.timeoutSeconds)
      : 30;
  return Math.floor(timeoutSec * 1000);
}

function toMoscowIso(date: Date): string {
  // YYYY-MM-DDTHH:mm:ss+03:00
  const ms = date.getTime() + 3 * 60 * 60 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}+03:00`;
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isNalogoConfigured(config: NalogoConfig): boolean {
  return Boolean(config.enabled && config.inn?.trim() && config.password?.trim());
}

function generateDeviceId(): string {
  return randomBytes(11).toString("hex").slice(0, 21).toLowerCase();
}

function normalizeDeviceId(raw: string | null | undefined): string {
  const cleaned = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 21);
  return cleaned.length >= 8 ? cleaned : generateDeviceId();
}

function buildDeviceInfo(deviceId: string): Record<string, unknown> {
  return {
    sourceType: NALOGO_DEVICE_SOURCE_TYPE,
    sourceDeviceId: deviceId,
    appVersion: NALOGO_APP_VERSION,
    metaDetails: {
      userAgent: NALOGO_USER_AGENT,
    },
  };
}

async function nalogoPostWithRetry(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${NALOGO_BASE}${path}`, {
          method: "POST",
          headers: { ...defaultHeaders(), ...(headers ?? {}) },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        return res;
      } finally {
        clearTimeout(timer);
      }
    } catch (e: unknown) {
      lastError = e;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("NaloGO network error");
}

export async function createNalogoReceipt(
  config: NalogoConfig,
  params: {
    name: string;
    amountRub: number;
    quantity?: number;
    clientPhone?: string | null;
    clientName?: string | null;
    clientInn?: string | null;
  },
): Promise<NalogoCreateReceiptResult> {
  if (!isNalogoConfigured(config)) {
    return {
      error: "NaloGO не настроен (nalogo_enabled=false или пустые ИНН/пароль).",
      status: 400,
      retryable: false,
    };
  }

  const amount = Math.round(params.amountRub * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Некорректная сумма для чека", status: 400, retryable: false };
  }

  const timeoutMs = resolveTimeoutMs(config);
  const inn = String(config.inn).trim();
  const password = String(config.password).trim();
  const deviceId = normalizeDeviceId(config.deviceId);
  const deviceInfo = buildDeviceInfo(deviceId);

  try {
    // 1) Авторизация
    const authRes = await nalogoPostWithRetry(
      "/v1/auth/lkfl",
      {
        username: inn,
        password,
        deviceInfo,
      },
      timeoutMs,
    );

    const authData = await parseJsonSafe(authRes);
    if (!authRes.ok) {
      return {
        error: `NaloGO auth failed: ${authData.message ?? authData.error ?? `HTTP ${authRes.status}`}`,
        status: authRes.status,
        retryable: isRetryableStatus(authRes.status),
      };
    }

    const tokenRaw = authData.token;
    if (typeof tokenRaw !== "string" || !tokenRaw.trim()) {
      return {
        error: "NaloGO auth: token отсутствует в ответе",
        status: 502,
        retryable: true,
      };
    }

    // 2) Создание чека
    const now = new Date();
    const quantity = Number.isFinite(params.quantity) && Number(params.quantity) > 0 ? Number(params.quantity) : 1;
    const opTime = toMoscowIso(now);
    const totalAmount = amount.toFixed(2);
    const requestBody = {
      operationTime: opTime,
      requestTime: opTime,
      services: [
        {
          name: params.name.slice(0, 128),
          amount: totalAmount,
          quantity: String(quantity),
        },
      ],
      totalAmount,
      client: {
        contactPhone: params.clientPhone ?? null,
        displayName: params.clientName ?? null,
        incomeType: "FROM_INDIVIDUAL",
        inn: params.clientInn ?? null,
      },
      paymentType: "CASH",
      ignoreMaxTotalIncomeRestriction: false,
    };

    const incomeRes = await nalogoPostWithRetry(
      "/v1/income",
      requestBody,
      timeoutMs,
      { Authorization: `Bearer ${tokenRaw}` },
    );

    const incomeData = await parseJsonSafe(incomeRes);
    if (!incomeRes.ok) {
      return {
        error: `NaloGO income failed: ${incomeData.message ?? incomeData.error ?? `HTTP ${incomeRes.status}`}`,
        status: incomeRes.status,
        retryable: isRetryableStatus(incomeRes.status),
      };
    }

    const receiptUuidRaw =
      incomeData.approvedReceiptUuid ?? incomeData.receiptUuid ?? incomeData.uuid;
    const receiptUuid =
      typeof receiptUuidRaw === "string" ? receiptUuidRaw.trim() : "";
    if (!receiptUuid) {
      return {
        error: "NaloGO не вернул UUID чека",
        status: 502,
        retryable: true,
      };
    }

    return { receiptUuid };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return {
        error: "NaloGO timeout",
        status: 504,
        retryable: true,
      };
    }
    return {
      error: e instanceof Error ? e.message : "NaloGO unknown error",
      status: 502,
      retryable: true,
    };
  }
}
