import { env } from "../../config/index.js";

const DEFAULT_FPTN_TIMEOUT_MS = 15000;
const DEFAULT_FPTN_RETRY_ATTEMPTS = 2;
const DEFAULT_FPTN_RETRY_BASE_MS = 350;

export type FptnConfig = {
  enabled: boolean;
  apiUrl: string;
  authHeaderName: string;
  authHeaderValue: string;
  usernamePrefix: string;
  timeoutMs: number;
  retryAttempts: number;
  retryBaseMs: number;
};

export type FptnFetchResult<T> = { data?: T; error?: string; status: number };

export function parseBooleanFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number, min = 1): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
}

function normalizeHeaderValue(headerName: string, rawValue: string): string {
  const value = rawValue.trim();
  if (!value) return "";
  if (headerName.toLowerCase() !== "authorization") return value;
  if (/^(bearer|basic)\s+/i.test(value)) return value;
  return `Bearer ${value}`;
}

export function resolveFptnConfig(config?: Partial<Record<string, unknown>> | null): FptnConfig {
  const apiUrl = String(config?.fptnApiUrl ?? env.FPTN_API_URL ?? "").trim().replace(/\/$/, "");
  const authHeaderName = String(config?.fptnAuthHeader ?? env.FPTN_AUTH_HEADER ?? "Authorization").trim() || "Authorization";
  const authHeaderValue = normalizeHeaderValue(
    authHeaderName,
    String(config?.fptnAuthToken ?? env.FPTN_AUTH_TOKEN ?? "").trim(),
  );
  const usernamePrefix = String(config?.fptnUsernamePrefix ?? env.FPTN_USERNAME_PREFIX ?? "fptn_").trim() || "fptn_";
  const enabled = parseBooleanFlag(config?.fptnEnabled ?? env.FPTN_ENABLED, Boolean(apiUrl && authHeaderValue));
  const timeoutMs = parsePositiveInt(process.env.FPTN_FETCH_TIMEOUT_MS, DEFAULT_FPTN_TIMEOUT_MS);
  const retryAttempts = parsePositiveInt(process.env.FPTN_FETCH_RETRY_ATTEMPTS, DEFAULT_FPTN_RETRY_ATTEMPTS);
  const retryBaseMs = parsePositiveInt(process.env.FPTN_FETCH_RETRY_BASE_MS, DEFAULT_FPTN_RETRY_BASE_MS);
  return {
    enabled,
    apiUrl,
    authHeaderName,
    authHeaderValue,
    usernamePrefix,
    timeoutMs,
    retryAttempts,
    retryBaseMs,
  };
}

export function isFptnConfigured(config: FptnConfig): boolean {
  return Boolean(config.enabled && config.apiUrl && config.authHeaderName && config.authHeaderValue);
}

function getHeaders(config: FptnConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    [config.authHeaderName]: config.authHeaderValue,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(250, Math.floor(seconds * 1000));
  const when = Date.parse(value);
  if (Number.isFinite(when)) {
    const delta = when - Date.now();
    if (delta > 0) return Math.max(250, delta);
  }
  return null;
}

function isRetryableMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function isRetryableStatus(status: number, method: string): boolean {
  if (status === 429) return true;
  return isRetryableMethod(method) && (status === 408 || status >= 500);
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const obj = data as Record<string, unknown>;
  const direct = obj.message ?? obj.error ?? obj.detail;
  if (typeof direct === "string" && direct.trim()) return direct;
  const nested = obj.response ?? obj.data;
  if (nested && typeof nested === "object") {
    const nestedObj = nested as Record<string, unknown>;
    const nestedMessage = nestedObj.message ?? nestedObj.error ?? nestedObj.detail;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage;
  }
  return fallback;
}

export async function fptnFetch<T>(
  config: FptnConfig,
  path: string,
  options: RequestInit = {},
): Promise<FptnFetchResult<T>> {
  if (!isFptnConfigured(config)) {
    return { error: "FPTN API not configured", status: 503 };
  }

  const url = `${config.apiUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const method = (options.method ?? "GET").toUpperCase();

  for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
    const onAbort = () => controller.abort();

    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: { ...getHeaders(config), ...(options.headers as Record<string, string> | undefined) },
      });
      const text = await response.text();
      let data: T | undefined;
      if (text) {
        try {
          data = JSON.parse(text) as T;
        } catch {
          // ignore non-json bodies
        }
      }
      if (!response.ok) {
        if (attempt < config.retryAttempts && isRetryableStatus(response.status, method)) {
          await sleep(parseRetryAfterMs(response.headers.get("retry-after")) ?? config.retryBaseMs * attempt);
          continue;
        }
        return {
          error: getErrorMessage(data, response.statusText || text.slice(0, 200)),
          status: response.status,
        };
      }
      return { data: data as T, status: response.status };
    } catch (error) {
      const abortedByOuterSignal = Boolean(options.signal?.aborted);
      const isAbortError = (error as { name?: string })?.name === "AbortError";
      if (attempt < config.retryAttempts && isRetryableMethod(method) && !abortedByOuterSignal) {
        await sleep(config.retryBaseMs * attempt);
        continue;
      }
      if (isAbortError) {
        return { error: `FPTN request timeout after ${config.timeoutMs}ms (${path})`, status: 504 };
      }
      return {
        error: error instanceof Error ? error.message : String(error),
        status: 500,
      };
    } finally {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }
  }

  return { error: "FPTN request failed after retries", status: 500 };
}

export function fptnGetUserDetails(config: FptnConfig, username: string) {
  return fptnFetch<unknown>(config, `/api/v1/billing/users/${encodeURIComponent(username)}`);
}

export function fptnGetAccessKey(config: FptnConfig, username: string) {
  return fptnFetch<unknown>(config, `/api/v1/billing/access-keys/${encodeURIComponent(username)}`);
}

export function fptnUpsertUser(config: FptnConfig, body: { username: string }) {
  return fptnFetch<unknown>(config, "/api/v1/billing/users/upsert", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fptnExtendSubscription(config: FptnConfig, body: { username: string; days: number }) {
  return fptnFetch<unknown>(config, "/api/v1/billing/subscriptions/extend", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fptnRotateAccessKey(config: FptnConfig, body: { username: string }) {
  return fptnFetch<unknown>(config, "/api/v1/billing/access-keys/rotate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function unwrapFptnPayload<T extends Record<string, unknown> = Record<string, unknown>>(data: unknown): T | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const nested = root.response ?? root.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as T;
  }
  return root as T;
}

function extractStringFromCandidates(data: unknown, candidates: readonly string[]): string | null {
  const payload = unwrapFptnPayload(data);
  if (!payload) return null;
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function extractFptnUsername(data: unknown): string | null {
  return extractStringFromCandidates(data, ["username", "userName", "login", "name"]);
}

export function extractFptnAccessKey(data: unknown): string | null {
  return extractStringFromCandidates(data, [
    "accessKey",
    "access_key",
    "key",
    "token",
    "fptnToken",
    "fptn_token",
    "configUrl",
    "config_url",
    "subscriptionUrl",
    "subscription_url",
    "url",
  ]);
}

export function extractFptnExpireAt(data: unknown): string | null {
  return extractStringFromCandidates(data, [
    "expireAt",
    "expiresAt",
    "expiredAt",
    "subscriptionEndsAt",
    "activeUntil",
    "validUntil",
    "until",
  ]);
}

export function extractFptnStatus(data: unknown): string | null {
  const payload = unwrapFptnPayload(data);
  if (!payload) return null;
  const direct = payload.status ?? payload.subscriptionStatus ?? payload.state;
  if (typeof direct === "string" && direct.trim()) return direct.trim().toUpperCase();
  if (typeof payload.isActive === "boolean") return payload.isActive ? "ACTIVE" : "INACTIVE";
  if (typeof payload.active === "boolean") return payload.active ? "ACTIVE" : "INACTIVE";
  return null;
}

export function isFptnNotFoundError(status: number, error?: string): boolean {
  if (status === 404) return true;
  const message = (error ?? "").toLowerCase();
  return message.includes("not found") || message.includes("does not exist") || message.includes("unknown user");
}
