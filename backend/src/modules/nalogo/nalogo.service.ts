/**
 * Минимальная интеграция с API "Мой Налог" (NaloGO):
 * - авторизация по ИНН/паролю
 * - создание чека о доходе
 *
 * Основано на рабочей логике из remnawave-bedolaga-telegram-bot-main.
 */

import { createHash, randomBytes } from "crypto";
import { spawn } from "child_process";
import { lookup, resolve4 } from "dns/promises";
import { request as httpsRequest } from "https";
import { connect as netConnect, type Socket } from "net";
import path from "path";
import { connect as tlsConnect, type TLSSocket } from "tls";

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
  proxyUrl?: string | null;
};

export type NalogoCreateReceiptResult =
  | { receiptUuid: string }
  | { error: string; status: number; retryable: boolean };

type NalogoPythonBridgeOutput = {
  ok?: boolean;
  receiptUuid?: unknown;
  error?: unknown;
  status?: unknown;
  retryable?: unknown;
};

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

function isFalseLike(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

function isTrueLike(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function normalizeHttpStatus(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const status = Math.floor(n);
  if (status < 100 || status > 599) return fallback;
  return status;
}

function mergeBridgeAndNativeError(
  bridgeError: Extract<NalogoCreateReceiptResult, { error: string }> | null,
  nativeError: Extract<NalogoCreateReceiptResult, { error: string }>,
): Extract<NalogoCreateReceiptResult, { error: string }> {
  if (!bridgeError) return nativeError;
  return {
    status: nativeError.status,
    retryable: bridgeError.retryable || nativeError.retryable,
    error: `python-bridge: ${bridgeError.error}; native: ${nativeError.error}`.slice(0, 500),
  };
}

async function createNalogoReceiptViaPythonBridge(
  config: NalogoConfig,
  params: {
    name: string;
    amountRub: number;
    quantity?: number;
    clientPhone?: string | null;
    clientName?: string | null;
    clientInn?: string | null;
  },
  timeoutMs: number,
): Promise<NalogoCreateReceiptResult | null> {
  if (isFalseLike(process.env.NALOGO_PYTHON_BRIDGE_ENABLED)) {
    return null;
  }

  const pythonBin = (process.env.NALOGO_PYTHON_BIN ?? "python3").trim() || "python3";
  const scriptPath = (
    process.env.NALOGO_PYTHON_BRIDGE_PATH ??
    path.join(process.cwd(), "scripts", "nalogo_bridge.py")
  ).trim();

  const payload = {
    inn: String(config.inn ?? "").trim(),
    password: String(config.password ?? "").trim(),
    name: params.name,
    amountRub: params.amountRub,
    quantity: params.quantity,
    clientPhone: params.clientPhone ?? null,
    clientName: params.clientName ?? null,
    clientInn: params.clientInn ?? null,
    operationTimeIso: new Date().toISOString(),
  };

  return await new Promise<NalogoCreateReceiptResult>((resolve) => {
    const child = spawn(pythonBin, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: NalogoCreateReceiptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        error: "NaloGO python bridge timeout",
        status: 504,
        retryable: true,
      });
    }, Math.max(timeoutMs, 3000));

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finish({
        error: `NaloGO python bridge start failed: ${error.message}`,
        status: 502,
        retryable: true,
      });
    });

    child.on("close", (code) => {
      const out = stdout.trim();
      const err = stderr.trim();
      let parsed: NalogoPythonBridgeOutput | null = null;
      if (out) {
        try {
          parsed = JSON.parse(out) as NalogoPythonBridgeOutput;
        } catch {
          parsed = null;
        }
      }

      const parsedUuid =
        parsed && typeof parsed.receiptUuid === "string" && parsed.receiptUuid.trim()
          ? parsed.receiptUuid.trim()
          : null;
      if (code === 0 && parsed?.ok === true && parsedUuid) {
        finish({ receiptUuid: parsedUuid });
        return;
      }

      const parsedError =
        parsed && typeof parsed.error === "string" && parsed.error.trim()
          ? parsed.error.trim()
          : null;
      const fallbackMsg = err || out || `python bridge exited with code ${code ?? -1}`;
      const message = `NaloGO python bridge failed: ${parsedError ?? fallbackMsg}`.slice(0, 500);
      const status = normalizeHttpStatus(parsed?.status, 502);
      const retryable =
        parsed && typeof parsed.retryable === "boolean"
          ? parsed.retryable
          : true;

      finish({
        error: message,
        status,
        retryable,
      });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
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

type SocksProxyConfig = {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  label: string;
};

function parseSocksProxyConfig(
  raw: string | null | undefined,
): { proxy: SocksProxyConfig | null; error?: string } {
  const input = (raw ?? "").trim();
  if (!input) return { proxy: null };

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { proxy: null, error: "NaloGO proxy: некорректный URL" };
  }

  const protocol = parsed.protocol.toLowerCase();
  const allowed = new Set(["socks:", "socks5:", "socks5h:"]);
  if (!allowed.has(protocol)) {
    return { proxy: null, error: "NaloGO proxy: поддерживаются только socks5:// или socks5h://" };
  }
  if (!parsed.hostname) {
    return { proxy: null, error: "NaloGO proxy: не указан хост" };
  }

  const rawPort = parsed.port ? Number(parsed.port) : 1080;
  if (!Number.isFinite(rawPort) || rawPort <= 0 || rawPort > 65535) {
    return { proxy: null, error: "NaloGO proxy: некорректный порт" };
  }

  const decodeSafe = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const username = parsed.username ? decodeSafe(parsed.username) : null;
  const password = parsed.password ? decodeSafe(parsed.password) : null;
  const authMask = username || password ? "***:***@" : "";

  return {
    proxy: {
      host: parsed.hostname,
      port: Math.floor(rawPort),
      username,
      password,
      label: `${protocol}//${authMask}${parsed.hostname}:${Math.floor(rawPort)}`,
    },
  };
}

function resolveNalogoProxyRaw(config: NalogoConfig): string {
  const fromSettings = (config.proxyUrl ?? "").trim();
  if (fromSettings) return fromSettings;
  return (process.env.NALOGO_PROXY_URL ?? "").trim();
}

function proxyModeLabel(proxy: SocksProxyConfig | null): string {
  return proxy ? `proxy=${proxy.label}` : "proxy=off";
}

function writeSocket(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      socket.off("error", onError);
      reject(err);
    };
    socket.on("error", onError);
    socket.write(data, () => {
      socket.off("error", onError);
      resolve();
    });
  });
}

async function readExact(socket: Socket, size: number, timeoutMs: number): Promise<Buffer> {
  const state = socket as Socket & { __nalogoReadBuf?: Buffer };
  let buf = state.__nalogoReadBuf ?? Buffer.alloc(0);
  const deadline = Date.now() + timeoutMs;

  const readChunk = (ms: number) => new Promise<Buffer>((resolve, reject) => {
    const onData = (chunk: Buffer) => cleanup(() => resolve(chunk));
    const onError = (err: Error) => cleanup(() => reject(err));
    const onEnd = () => cleanup(() => reject(new Error("Socket ended before enough data")));
    const onClose = () => cleanup(() => reject(new Error("Socket closed before enough data")));
    const timer = setTimeout(() => cleanup(() => reject(new Error("Socket read timeout"))), Math.max(1, ms));

    const cleanup = (fn: () => void) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      socket.off("close", onClose);
      fn();
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
    socket.on("close", onClose);
  });

  while (buf.length < size) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("Socket read timeout");
    const chunk = await readChunk(left);
    buf = Buffer.concat([buf, chunk]);
  }

  const out = buf.subarray(0, size);
  state.__nalogoReadBuf = buf.subarray(size);
  return out;
}

function buildSocksAddress(host: string): Buffer {
  const ipv4Parts = host.split(".");
  const isIpv4 =
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const n = Number(part);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  if (isIpv4) {
    return Buffer.from([0x01, ...ipv4Parts.map((part) => Number(part))]);
  }

  const hostBytes = Buffer.from(host, "utf8");
  if (hostBytes.length === 0 || hostBytes.length > 255) {
    throw new Error("NaloGO proxy: target host length is invalid");
  }
  return Buffer.concat([Buffer.from([0x03, hostBytes.length]), hostBytes]);
}

function socksReplyToError(code: number): string {
  switch (code) {
    case 0x01:
      return "general SOCKS server failure";
    case 0x02:
      return "connection not allowed by ruleset";
    case 0x03:
      return "network unreachable";
    case 0x04:
      return "host unreachable";
    case 0x05:
      return "connection refused";
    case 0x06:
      return "TTL expired";
    case 0x07:
      return "command not supported";
    case 0x08:
      return "address type not supported";
    default:
      return `unknown reply code ${code}`;
  }
}

async function createSocksTlsConnection(
  proxy: SocksProxyConfig,
  connectHost: string,
  targetPort: number,
  tlsServerName: string,
  timeoutMs: number,
): Promise<TLSSocket> {
  const socket = netConnect({ host: proxy.host, port: proxy.port });
  socket.setNoDelay(true);
  socket.setTimeout(timeoutMs, () => {
    socket.destroy(new Error(`SOCKS proxy timeout (${proxy.label})`));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => cleanup(() => resolve());
      const onError = (err: Error) => cleanup(() => reject(err));
      const onClose = () => cleanup(() => reject(new Error(`SOCKS proxy closed (${proxy.label})`)));
      const timer = setTimeout(
        () => cleanup(() => reject(new Error(`SOCKS connect timeout (${proxy.label})`))),
        timeoutMs,
      );
      const cleanup = (fn: () => void) => {
        clearTimeout(timer);
        socket.off("connect", onConnect);
        socket.off("error", onError);
        socket.off("close", onClose);
        fn();
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
      socket.once("close", onClose);
    });

    const methods = proxy.username || proxy.password ? Buffer.from([0x00, 0x02]) : Buffer.from([0x00]);
    await writeSocket(socket, Buffer.concat([Buffer.from([0x05, methods.length]), methods]));
    const methodResponse = await readExact(socket, 2, timeoutMs);
    if (methodResponse[0] !== 0x05 || methodResponse[1] === 0xff) {
      throw new Error(`SOCKS auth method rejected (${proxy.label})`);
    }

    if (methodResponse[1] === 0x02) {
      const username = proxy.username ?? "";
      const password = proxy.password ?? "";
      const userBytes = Buffer.from(username, "utf8");
      const passBytes = Buffer.from(password, "utf8");
      if (userBytes.length > 255 || passBytes.length > 255) {
        throw new Error("SOCKS credentials are too long");
      }
      await writeSocket(
        socket,
        Buffer.concat([
          Buffer.from([0x01, userBytes.length]),
          userBytes,
          Buffer.from([passBytes.length]),
          passBytes,
        ]),
      );
      const authResponse = await readExact(socket, 2, timeoutMs);
      if (authResponse[0] !== 0x01 || authResponse[1] !== 0x00) {
        throw new Error(`SOCKS auth failed (${proxy.label})`);
      }
    }

    const hostPart = buildSocksAddress(connectHost);
    const portPart = Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]);
    await writeSocket(socket, Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), hostPart, portPart]));

    const responseHead = await readExact(socket, 4, timeoutMs);
    if (responseHead[0] !== 0x05) {
      throw new Error(`SOCKS invalid version response (${proxy.label})`);
    }
    if (responseHead[1] !== 0x00) {
      throw new Error(`SOCKS connect failed: ${socksReplyToError(responseHead[1])} (${proxy.label})`);
    }
    if (responseHead[3] === 0x01) {
      await readExact(socket, 4 + 2, timeoutMs);
    } else if (responseHead[3] === 0x04) {
      await readExact(socket, 16 + 2, timeoutMs);
    } else if (responseHead[3] === 0x03) {
      const domainLen = await readExact(socket, 1, timeoutMs);
      await readExact(socket, domainLen[0] + 2, timeoutMs);
    } else {
      throw new Error(`SOCKS unsupported BND address type ${responseHead[3]} (${proxy.label})`);
    }

    const tlsSocket = tlsConnect({
      socket,
      servername: tlsServerName,
      timeout: timeoutMs,
    });

    await new Promise<void>((resolve, reject) => {
      const onSecure = () => cleanup(() => resolve());
      const onError = (err: Error) => cleanup(() => reject(err));
      const onClose = () => cleanup(() => reject(new Error(`TLS tunnel closed (${proxy.label})`)));
      const timer = setTimeout(() => cleanup(() => reject(new Error("TLS handshake timeout"))), timeoutMs);
      const cleanup = (fn: () => void) => {
        clearTimeout(timer);
        tlsSocket.off("secureConnect", onSecure);
        tlsSocket.off("error", onError);
        tlsSocket.off("close", onClose);
        fn();
      };
      tlsSocket.once("secureConnect", onSecure);
      tlsSocket.once("error", onError);
      tlsSocket.once("close", onClose);
    });

    // Таймаут нужен только на этапе установления туннеля.
    // Дальше его контролирует HTTP-запрос, иначе возможен
    // поздний timeout с необработанным error на TLSSocket.
    socket.setTimeout(0);
    tlsSocket.setTimeout(0);

    return tlsSocket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function resolveIpv4Candidates(hostname: string): Promise<string[]> {
  const unique = new Set<string>();
  try {
    const resolved = await resolve4(hostname);
    for (const ip of resolved) {
      if (typeof ip === "string" && ip.trim()) unique.add(ip.trim());
    }
  } catch {
    // fallback below
  }

  if (unique.size === 0) {
    const fallback = await lookup(hostname, { family: 4 });
    if (typeof fallback.address === "string" && fallback.address.trim()) {
      unique.add(fallback.address.trim());
    }
  }

  return Array.from(unique);
}

async function nalogoPostViaHttpsAddress(
  target: URL,
  connectHost: string,
  bodyText: string,
  timeoutMs: number,
  headers: Record<string, string>,
  proxy: SocksProxyConfig | null,
): Promise<Response> {
  const targetPort = target.port ? Number(target.port) : 443;
  const tlsSocket = proxy
    ? await createSocksTlsConnection(
        proxy,
        connectHost,
        targetPort,
        target.hostname,
        timeoutMs,
      )
    : null;

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (tlsSocket) tlsSocket.destroy();
      reject(error);
    };
    const reqHost = proxy ? target.hostname : connectHost;
    const req = httpsRequest(
      {
        protocol: target.protocol,
        host: reqHost,
        servername: target.hostname,
        port: targetPort,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: {
          ...headers,
          Host: target.host,
          Connection: "close",
          "Content-Length": String(Buffer.byteLength(bodyText)),
        },
        ...(tlsSocket
          ? {
              agent: false,
              createConnection: () => tlsSocket,
            }
          : {}),
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
          settled = true;
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
      const timeoutLabel = proxy ? proxy.label : connectHost;
      req.destroy(new Error(`NaloGO fallback timeout (${timeoutLabel})`));
    });
    req.on("error", fail);
    if (tlsSocket) {
      // В режиме createConnection сокет живёт отдельно.
      // Без обработчика здесь Node может упасть на unhandled error.
      tlsSocket.on("error", fail);
    }
    req.write(bodyText);
    req.end();
  });
}

async function nalogoPostViaHttpsFallback(
  url: string,
  bodyText: string,
  timeoutMs: number,
  headers: Record<string, string>,
  proxy: SocksProxyConfig | null,
): Promise<Response> {
  const target = new URL(url);
  if (proxy) {
    const candidates = Array.from(
      new Set([target.hostname, ...(await resolveIpv4Candidates(target.hostname))]),
    );
    const perTargetTimeoutMs = Math.max(
      4000,
      Math.min(15000, Math.floor(timeoutMs / Math.max(1, candidates.length))),
    );
    const failures: string[] = [];
    for (const connectHost of candidates) {
      try {
        return await nalogoPostViaHttpsAddress(
          target,
          connectHost,
          bodyText,
          perTargetTimeoutMs,
          headers,
          proxy,
        );
      } catch (error) {
        failures.push(formatNetworkError(error, `proxy-target:${connectHost}`));
      }
    }
    throw new Error(
      `NaloGO proxy fallback failed for ${target.hostname}: ${failures.join("; ")}`,
    );
  }

  const addresses = await resolveIpv4Candidates(target.hostname);
  const perAddressTimeoutMs = Math.max(4000, Math.min(15000, Math.floor(timeoutMs / Math.max(1, addresses.length))));

  const failures: string[] = [];
  for (const address of addresses) {
    try {
      return await nalogoPostViaHttpsAddress(
        target,
        address,
        bodyText,
        perAddressTimeoutMs,
        headers,
        null,
      );
    } catch (error) {
      failures.push(formatNetworkError(error, `ip:${address}`));
    }
  }

  throw new Error(`NaloGO fallback failed for ${target.hostname}: ${failures.join("; ")}`);
}
async function authorizeNalogo(
  inn: string,
  password: string,
  deviceId: string,
  timeoutMs: number,
  proxy: SocksProxyConfig | null,
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
      undefined,
      proxy,
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
  proxy?: SocksProxyConfig | null,
): Promise<Response> {
  const url = `${NALOGO_BASE}${path}`;
  const mergedHeaders = { ...defaultHeaders(), ...(headers ?? {}) };
  const bodyText = JSON.stringify(body);
  const fetchTimeoutMs = Math.max(4000, Math.min(12000, timeoutMs));
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (proxy) {
        return await nalogoPostViaHttpsFallback(
          url,
          bodyText,
          timeoutMs,
          mergedHeaders,
          proxy,
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
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
      if (proxy) {
        lastError = new Error(formatNetworkError(e, "proxy-request"));
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        break;
      }

      const fetchError = formatNetworkError(e, "fetch");
      try {
        return await nalogoPostViaHttpsFallback(
          url,
          bodyText,
          timeoutMs,
          mergedHeaders,
          proxy ?? null,
        );
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
  const bridgeOnly = isTrueLike(process.env.NALOGO_PYTHON_BRIDGE_ONLY);
  let bridgeFailure: Extract<NalogoCreateReceiptResult, { error: string }> | null = null;
  const pythonBridgeResult = await createNalogoReceiptViaPythonBridge(
    config,
    params,
    timeoutMs,
  );
  if (pythonBridgeResult) {
    if ("receiptUuid" in pythonBridgeResult) {
      return pythonBridgeResult;
    }
    if (bridgeOnly) {
      return pythonBridgeResult;
    }
    bridgeFailure = pythonBridgeResult;
  }

  const inn = String(config.inn).trim();
  const password = String(config.password).trim();
  const deviceId = normalizeDeviceId(config.deviceId, inn);
  // Прокси отключён принудительно по запросу: работаем только напрямую.
  const proxy: SocksProxyConfig | null = null;
  try {
    // 1) Авторизация
    const authResult = await authorizeNalogo(inn, password, deviceId, timeoutMs, proxy);
    if ("error" in authResult) {
      return mergeBridgeAndNativeError(bridgeFailure, authResult);
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
      proxy,
    );

    const incomeData = await parseJsonSafe(incomeRes);
    if (!incomeRes.ok) {
      return mergeBridgeAndNativeError(bridgeFailure, {
        error: `NaloGO income failed: ${extractErrorMessage(incomeData, `HTTP ${incomeRes.status}`)}`,
        status: incomeRes.status,
        retryable: isRetryableStatus(incomeRes.status),
      });
    }

    const receiptUuidRaw =
      incomeData.approvedReceiptUuid ?? incomeData.receiptUuid ?? incomeData.uuid;
    const receiptUuid =
      typeof receiptUuidRaw === "string" ? receiptUuidRaw.trim() : "";
    if (!receiptUuid) {
      return mergeBridgeAndNativeError(bridgeFailure, {
        error: "NaloGO не вернул UUID чека",
        status: 502,
        retryable: true,
      });
    }

    return { receiptUuid };
  } catch (e) {
    if (isTimeoutError(e)) {
      const details = e instanceof Error && e.message ? `: ${e.message}` : "";
      return mergeBridgeAndNativeError(bridgeFailure, {
        error: `NaloGO timeout (${proxyModeLabel(proxy)})${details}`.slice(0, 500),
        status: 504,
        retryable: true,
      });
    }
    const eMessage = e instanceof Error ? e.message : "NaloGO unknown error";
    return mergeBridgeAndNativeError(bridgeFailure, {
      error: `${eMessage} (${proxyModeLabel(proxy)})`.slice(0, 500),
      status: 502,
      retryable: true,
    });
  }
}
