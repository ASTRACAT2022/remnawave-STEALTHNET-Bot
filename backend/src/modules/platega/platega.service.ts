/**
 * Platega.io — создание платежей и обработка callback
 * https://docs.platega.io/
 */

const PLATEGA_API_BASE = "https://app.platega.io";
const PLATEGA_TIMEOUT_MS = 20000;

export type PlategaConfig = {
  merchantId: string;
  secret: string;
};

export function isPlategaConfigured(config: PlategaConfig | null): boolean {
  return Boolean(config?.merchantId?.trim() && config?.secret?.trim());
}

function pickString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "bigint") return String(v);
  }
  return "";
}

/**
 * Создать транзакцию в Platega, получить ссылку на оплату
 * paymentMethod: 2=СПБ, 11=Карты, 12=Международный, 13=Криптовалюта
 */
export async function createPlategaTransaction(
  config: PlategaConfig,
  params: {
    amount: number;
    currency: string;
    orderId: string;
    paymentMethod: number;
    returnUrl: string;
    failedUrl: string;
    description?: string;
  }
): Promise<{ paymentUrl: string; transactionId: string } | { error: string }> {
  const { amount, currency, orderId, paymentMethod, returnUrl, failedUrl, description } = params;
  const url = `${PLATEGA_API_BASE}/transaction/process`;
  const body: Record<string, unknown> = {
    paymentMethod: Number(paymentMethod) || 2,
    paymentDetails: { amount: Number(amount), currency: currency.toUpperCase() },
    description: description || `Оплата заказа ${orderId}`,
    return: returnUrl,
    failedUrl,
    payload: orderId, // orderId передаём через payload — единственное кастомное поле в API Platega
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MerchantId": config.merchantId.trim(),
    "X-Secret": config.secret.trim(),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PLATEGA_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { error: `Platega: invalid response (${res.status})` };
    }

    if (res.status === 401) {
      return { error: "Platega: неверный Merchant ID или секрет" };
    }
    if (res.status !== 200) {
      const msg = pickString(data.message, data.error, data.details, text.slice(0, 200)) || `HTTP ${res.status}`;
      return { error: `Platega (${res.status}): ${msg}` };
    }

    const paymentUrl = pickString(data.redirect, data.url, data.paymentUrl, data.payment_url, data.link);
    const transactionId = pickString(data.transactionId, data.transaction_id, data.id);

    if (!paymentUrl) {
      return { error: "Platega не вернул ссылку на оплату" };
    }

    return { paymentUrl, transactionId: transactionId || "" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { error: "Platega: таймаут при создании транзакции" };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Platega: ${message}` };
  }
}
