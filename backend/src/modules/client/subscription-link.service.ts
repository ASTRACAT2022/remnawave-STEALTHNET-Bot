const DEFAULT_HAPP_CRYPTO_API_URL = "https://crypto.happ.su/api-v2.php";
const DEFAULT_HAPP_CRYPTO_TIMEOUT_MS = 8000;
const DEFAULT_HAPP_CRYPTO_CACHE_TTL_MS = 15 * 60 * 1000;
const SUBSCRIPTION_LINK_KEYS = new Set(["subscriptionUrl", "subscription_url"]);

type CacheEntry = {
  value: string;
  expiresAt: number;
};

const encryptedLinkCache = new Map<string, CacheEntry>();

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function getCryptoApiUrl(): string {
  const configured = process.env.HAPP_CRYPTO_API_URL?.trim();
  return configured || DEFAULT_HAPP_CRYPTO_API_URL;
}

function getCryptoTimeoutMs(): number {
  return parsePositiveInt(process.env.HAPP_CRYPTO_TIMEOUT_MS, DEFAULT_HAPP_CRYPTO_TIMEOUT_MS);
}

function getCryptoCacheTtlMs(): number {
  return parsePositiveInt(process.env.HAPP_CRYPTO_CACHE_TTL_MS, DEFAULT_HAPP_CRYPTO_CACHE_TTL_MS);
}

function isHappCryptoLink(url: string): boolean {
  return /^happ:\/\/crypt\d+\//i.test(url.trim());
}

function readCachedEncryptedLink(url: string): string | null {
  const cached = encryptedLinkCache.get(url);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    encryptedLinkCache.delete(url);
    return null;
  }
  return cached.value;
}

function writeCachedEncryptedLink(url: string, encryptedLink: string): void {
  encryptedLinkCache.set(url, {
    value: encryptedLink,
    expiresAt: Date.now() + getCryptoCacheTtlMs(),
  });
}

export async function encryptSubscriptionLinkWithHappCrypto(rawUrl: string): Promise<string> {
  const url = rawUrl.trim();
  if (!url || isHappCryptoLink(url)) return url;

  const cached = readCachedEncryptedLink(url);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getCryptoTimeoutMs());

  try {
    const response = await fetch(getCryptoApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const encryptedLink = payload
      && typeof payload === "object"
      && !Array.isArray(payload)
      && typeof (payload as { encrypted_link?: unknown }).encrypted_link === "string"
      ? (payload as { encrypted_link: string }).encrypted_link.trim()
      : "";

    if (!encryptedLink) {
      throw new Error("encrypted_link is empty");
    }

    writeCachedEncryptedLink(url, encryptedLink);
    return encryptedLink;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[happ-crypto] subscription link encryption failed:", message);
    return url;
  } finally {
    clearTimeout(timeout);
  }
}

async function replaceSubscriptionLinksDeep(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => replaceSubscriptionLinksDeep(item)));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = await Promise.all(
    Object.entries(value).map(async ([key, nestedValue]) => {
      if (SUBSCRIPTION_LINK_KEYS.has(key) && typeof nestedValue === "string") {
        return [key, await encryptSubscriptionLinkWithHappCrypto(nestedValue)] as const;
      }
      return [key, await replaceSubscriptionLinksDeep(nestedValue)] as const;
    })
  );

  return Object.fromEntries(entries);
}

export async function toHappCryptoSubscriptionPayload<T>(payload: T): Promise<T> {
  return (await replaceSubscriptionLinksDeep(payload)) as T;
}

