/**
 * Минимальная интеграция с API "Мой Налог" (NaloGO):
 * - авторизация по ИНН/паролю
 * - создание чека о доходе
 *
 * Основано на рабочей логике из remnawave-bedolaga-telegram-bot-main.
 */

import { createHash, randomBytes } from "crypto";
import { lookup } from "dns/promises";
import { request as httpsRequest } from "https";

const NALOGO_BASE = (process.env.NALOGO_BASE_URL ?? "https://lknpd.nalog.ru/api")
  .trim()
  .replace(/\/+$/, "");
const NALOGO_DEVICE_SOURCE_TYPE = "WEB";
const NALOGO_DEVICE_SOURCE_TYPE_FALLBACKS = ["WEB", "APP", "WEB_SITE", "IOS", "ANDROID"];
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

function normalizeDeviceId(raw: string | null | undefined, stableSeed?: string): string {
  const cleaned = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 21);
  if (cleaned.length >= 8) return cleaned;

  const seed = (stableSeed ?? "").trim();
  if (seed) {
    return createHash("sha256")
      .update(`nalogo:${seed}`)
      .digest("hex")
      .slice(0, 21)
      .toLowerCase();
  }
  return generateDeviceId();
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

function extractErrorMessage(data: Record<string, unknown>, fallback: string): string {
  const raw = data.message ?? data.error ?? fallback;
  return typeof raw === "string" ? raw : fallback;
}

function shouldRetryAuthWithFallback(authStatus: number, authData: Record<string, unknown>): boolean {
  if (isRetryableStatus(authStatus)) return true;
  const message = extractErrorMessage(authData, "").toLowerCase();
  return message.includes("тип устройства") || message.includes("device type") || message.includes("source");
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.trim()) return code.trim();
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return null;
  const causeCode = (cause as { code?: unknown }).code;
  if (typeof causeCode === "string" && causeCode.trim()) return causeCode.trim();
  return null;
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  const code = getErrorCode(error);
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") {
    return true;
  }
  const msg = error instanceof Error ? error.message.toLowerCase() : "";
  return msg.includes("timeout");
}

function formatNetworkError(error: unknown, label: string): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown network error";
  const code = getErrorCode(error);
  return code ? `${label}: ${message} (${code})` : `${label}: ${message}`;
}

async function nalogoPostViaHttpsFallback(
  url: string,
  bodyText: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<Response> {
  const target = new URL(url);
  const resolved = await lookup(target.hostname, { family: 4 });

  return await new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: target.protocol,
        host: resolved.address,
        servername: target.hostname,
        port: target.port ? Number(target.port) : 443,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: {
          ...headers,
          Host: target.host,
          Connection: "close",
          "Content-Length": String(Buffer.byteLength(bodyText)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk);
            return;
          }
          chunks.push(Buffer.from(String(chunk)));
        });
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              responseHeaders.set(key, value.join(", "));
            } else if (typeof value === "string") {
              responseHeaders.set(key, value);
            }
          }
          resolve(
            new Response(Buffer.concat(chunks).toString("utf8"), {
              status: res.statusCode ?? 502,
              headers: responseHeaders,
            }),
          );
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("NaloGO fallback timeout"));
    });
    req.on("error", reject);
    req.write(bodyText);
    req.end();
  });
}
async function authorizeNalogo(
  inn: string,
  password: string,
  deviceId: string,
  timeoutMs: number,
): Promise<{ token: string } | { error: string; status: number; retryable: boolean }> {
  const sourceTypeCandidates = Array.from(
    new Set([NALOGO_DEVICE_SOURCE_TYPE, ...NALOGO_DEVICE_SOURCE_TYPE_FALLBACKS]),
  );

  let lastError: { error: string; status: number; retryable: boolean } | null = null;

  for (let i = 0; i < sourceTypeCandidates.length; i += 1) {
    const sourceType = sourceTypeCandidates[i];
    const authRes = await nalogoPostWithRetry(
      "/v1/auth/lkfl",
      {
        username: inn,
        password,
        deviceInfo: {
          ...buildDeviceInfo(deviceId),
          sourceType,
        },
      },
      timeoutMs,
    );

    const authData = await parseJsonSafe(authRes);
    if (authRes.ok) {
      const tokenRaw = authData.token;
      if (typeof tokenRaw === "string" && tokenRaw.trim()) {
        return { token: tokenRaw.trim() };
      }
      return {
        error: "NaloGO auth: token отсутствует в ответе",
        status: 502,
        retryable: true,
      };
    }

    lastError = {
      error: `NaloGO auth failed: ${extractErrorMessage(authData, `HTTP ${authRes.status}`)}`,
      status: authRes.status,
      retryable: isRetryableStatus(authRes.status),
    };

    const canTryNext = i < sourceTypeCandidates.length - 1;
    if (!canTryNext || !shouldRetryAuthWithFallback(authRes.status, authData)) {
      return lastError;
    }
  }

  return (
    lastError ?? {
      error: "NaloGO auth failed: неизвестная ошибка",
      status: 502,
      retryable: true,
    }
  );
}

async function nalogoPostWithRetry(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<Response> {
  const url = `${NALOGO_BASE}${path}`;
  const mergedHeaders = { ...defaultHeaders(), ...(headers ?? {}) };
  const bodyText = JSON.stringify(body);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: mergedHeaders,
          body: bodyText,
          signal: controller.signal,
        });
        return res;
      } finally {
        clearTimeout(timer);
      }
    } catch (e: unknown) {
      const fetchError = formatNetworkError(e, "fetch");
      try {
        return await nalogoPostViaHttpsFallback(url, bodyText, timeoutMs, mergedHeaders);
      } catch (fallbackError) {
        const fallbackText = formatNetworkError(fallbackError, "https-fallback");
        lastError = new Error(`${fetchError}; ${fallbackText}`);
      }
      if (attempt < 3) {
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
  const deviceId = normalizeDeviceId(config.deviceId, inn);
  try {
    // 1) Авторизация
    const authResult = await authorizeNalogo(inn, password, deviceId, timeoutMs);
    if ("error" in authResult) {
      return authResult;
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
      { Authorization: `Bearer ${authResult.token}` },
    );

    const incomeData = await parseJsonSafe(incomeRes);
    if (!incomeRes.ok) {
      return {
        error: `NaloGO income failed: ${extractErrorMessage(incomeData, `HTTP ${incomeRes.status}`)}`,
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
    if (isTimeoutError(e)) {
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
