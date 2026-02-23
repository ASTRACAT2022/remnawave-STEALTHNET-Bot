"use client";

export type AuthMode = "scopes" | "bearer" | "api_key";

export interface AuthState {
  mode: AuthMode;
  scopes: string;
  accessToken: string;
  apiKey: string;
}

const STORAGE_KEY = "pepoapple_admin_auth";
const FALLBACK_SCOPES = process.env.NEXT_PUBLIC_API_SCOPES ?? "*";
const DEFAULT_STATE: AuthState = {
  mode: "scopes",
  scopes: FALLBACK_SCOPES,
  accessToken: "",
  apiKey: "",
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured && configured.trim()) {
    return trimTrailingSlash(configured.trim());
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return trimTrailingSlash(window.location.origin);
  }
  return "http://localhost:8080";
}

export function loadAuthState(): AuthState {
  if (typeof window === "undefined") {
    return DEFAULT_STATE;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    return {
      mode: parsed.mode ?? DEFAULT_STATE.mode,
      scopes: parsed.scopes ?? DEFAULT_STATE.scopes,
      accessToken: parsed.accessToken ?? "",
      apiKey: parsed.apiKey ?? "",
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveAuthState(next: AuthState): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function resetAuthState(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}

function buildHeaders(auth: AuthState, hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = {};
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  if (auth.mode === "bearer" && auth.accessToken) {
    headers.Authorization = `Bearer ${auth.accessToken}`;
  } else if (auth.mode === "api_key" && auth.apiKey) {
    headers["X-API-Key"] = auth.apiKey;
  } else if (auth.scopes) {
    headers["X-Scopes"] = auth.scopes;
  }

  return headers;
}

async function parseApiError(resp: Response): Promise<string> {
  try {
    const data = (await resp.json()) as { detail?: unknown; error?: string };
    if (typeof data.detail === "string") {
      return data.detail;
    }
    if (typeof data.error === "string") {
      return data.error;
    }
    if (data.detail) {
      return JSON.stringify(data.detail);
    }
  } catch {
    // Ignore parse errors.
  }
  return `${resp.status} ${resp.statusText}`;
}

function buildApiBaseCandidates(): string[] {
  const primary = getApiBaseUrl();
  const candidates = [primary];

  if (typeof window !== "undefined" && window.location?.origin) {
    const originBase = trimTrailingSlash(window.location.origin);
    let primaryHost = "";
    try {
      primaryHost = new URL(primary).hostname;
    } catch {
      primaryHost = "";
    }
    const shouldFallbackToOrigin =
      primaryHost === "" ||
      primaryHost === "localhost" ||
      primaryHost === "127.0.0.1" ||
      primaryHost === "0.0.0.0";
    if (shouldFallbackToOrigin && !candidates.includes(originBase)) {
      candidates.push(originBase);
    }
  }

  return candidates;
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  authOverride?: AuthState,
): Promise<T> {
  const auth = authOverride ?? loadAuthState();
  const method = init?.method ?? "GET";
  const hasBody = Boolean(init?.body);
  const candidates = buildApiBaseCandidates();
  let lastNetworkError: unknown = null;

  for (const baseUrl of candidates) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        method,
        headers: {
          ...buildHeaders(auth, hasBody),
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
    } catch (err) {
      lastNetworkError = err;
      continue;
    }

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    const raw = await response.text();
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  const urlList = candidates.join(", ");
  const reason = lastNetworkError instanceof Error ? lastNetworkError.message : "unknown network failure";
  throw new Error(`NetworkError: failed to reach API (${urlList}). ${reason}`);
}

export function formatDate(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function formatBytes(input: number): string {
  if (!Number.isFinite(input)) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = input;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
