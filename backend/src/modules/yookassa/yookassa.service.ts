/**
 * Интеграция с YooKassa API (https://yookassa.ru/developers/api)
 * - создание платежа (карта / СБП)
 * - запрос актуального статуса платежа
 */

import { randomUUID } from "crypto";

const YOOKASSA_API_BASE = "https://api.yookassa.ru/v3";
const YOOKASSA_TIMEOUT_MS = 20000;

export type YookassaConfig = {
  shopId: string;
  secretKey: string;
  returnUrl: string;
  defaultReceiptEmail?: string | null;
  vatCode?: number;
  paymentMode?: string;
  paymentSubject?: string;
};

type YookassaApiPayment = {
  id?: string;
  status?: string;
  paid?: boolean;
  captured_at?: string;
  metadata?: Record<string, unknown>;
  confirmation?: {
    type?: string;
    confirmation_url?: string;
  };
  payment_method?: {
    type?: string;
  };
  amount?: {
    value?: string;
    currency?: string;
  };
  error?: {
    code?: string;
    description?: string;
  };
  description?: string;
};

export type YookassaCreateResult =
  | {
      id: string;
      status: string;
      paid: boolean;
      confirmationUrl: string | null;
      paymentMethodType: string | null;
      amountValue: number;
      amountCurrency: string;
      raw: Record<string, unknown>;
      idempotenceKey: string;
    }
  | { error: string; status: number };

export type YookassaPaymentInfoResult =
  | {
      id: string;
      status: string;
      paid: boolean;
      confirmationUrl: string | null;
      paymentMethodType: string | null;
      amountValue: number | null;
      amountCurrency: string | null;
      raw: Record<string, unknown>;
    }
  | { error: string; status: number };

export function isYookassaConfigured(config: YookassaConfig | null): boolean {
  return Boolean(
    config?.shopId?.trim() &&
      config?.secretKey?.trim() &&
      config?.returnUrl?.trim(),
  );
}

function toAuthHeader(config: YookassaConfig): string {
  const raw = `${config.shopId.trim()}:${config.secretKey.trim()}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function toAmountValue(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2);
}

function pickMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const obj = data as Record<string, unknown>;
  if (typeof obj.description === "string" && obj.description.trim()) return obj.description;
  const error = obj.error;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const desc = typeof e.description === "string" ? e.description.trim() : "";
    const code = typeof e.code === "string" ? e.code.trim() : "";
    if (desc && code) return `${code}: ${desc}`;
    if (desc) return desc;
    if (code) return code;
  }
  return fallback;
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

export async function createYookassaPayment(
  config: YookassaConfig,
  params: {
    amount: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    receiptEmail?: string | null;
    receiptPhone?: string | null;
    paymentMethodType?: "bank_card" | "sbp";
  },
): Promise<YookassaCreateResult> {
  const amount = Math.round(params.amount * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Некорректная сумма платежа", status: 400 };
  }

  const customer: Record<string, string> = {};
  const receiptEmail =
    (params.receiptEmail ?? "").trim() || (config.defaultReceiptEmail ?? "").trim();
  const receiptPhone = (params.receiptPhone ?? "").trim();
  if (receiptEmail) {
    customer.email = receiptEmail;
  } else if (receiptPhone) {
    customer.phone = receiptPhone;
  } else {
    return {
      error:
        "Для YooKassa нужен email/телефон для чека (или yookassa_default_receipt_email в настройках).",
      status: 400,
    };
  }

  const description = (params.description || "Оплата").slice(0, 255);
  const currency = params.currency.toUpperCase();
  const idempotenceKey = randomUUID();
  const vatCode =
    Number.isFinite(config.vatCode) && Number(config.vatCode) > 0
      ? Number(config.vatCode)
      : 1;

  const body: Record<string, unknown> = {
    amount: { value: toAmountValue(amount), currency },
    capture: true,
    confirmation: {
      type: "redirect",
      return_url: config.returnUrl.trim(),
    },
    description,
    metadata: params.metadata,
    receipt: {
      customer,
      items: [
        {
          description: description.slice(0, 128),
          quantity: "1.00",
          amount: { value: toAmountValue(amount), currency },
          vat_code: String(vatCode),
          payment_mode: (config.paymentMode || "full_payment").trim() || "full_payment",
          payment_subject: (config.paymentSubject || "service").trim() || "service",
        },
      ],
    },
  };
  if (params.paymentMethodType) {
    body.payment_method_data = { type: params.paymentMethodType };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), YOOKASSA_TIMEOUT_MS);
    const res = await fetch(`${YOOKASSA_API_BASE}/payments`, {
      method: "POST",
      headers: {
        Authorization: toAuthHeader(config),
        "Content-Type": "application/json",
        "Idempotence-Key": idempotenceKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const data = (await parseJsonSafe(res)) as YookassaApiPayment & Record<string, unknown>;
    if (!res.ok) {
      return {
        error: pickMessage(data, `YooKassa HTTP ${res.status}`),
        status: res.status,
      };
    }
    if (!data.id || !data.status) {
      return { error: "YooKassa вернула неполный ответ", status: 502 };
    }

    const amountValueRaw = data.amount?.value ?? "0";
    const amountValue = Number(amountValueRaw);

    return {
      id: String(data.id),
      status: String(data.status),
      paid: Boolean(data.paid),
      confirmationUrl:
        data.confirmation?.confirmation_url &&
        String(data.confirmation.confirmation_url).trim()
          ? String(data.confirmation.confirmation_url)
          : null,
      paymentMethodType:
        data.payment_method?.type && String(data.payment_method.type).trim()
          ? String(data.payment_method.type)
          : null,
      amountValue: Number.isFinite(amountValue) ? amountValue : amount,
      amountCurrency:
        data.amount?.currency && String(data.amount.currency).trim()
          ? String(data.amount.currency).toUpperCase()
          : currency,
      raw: data,
      idempotenceKey,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { error: "YooKassa: таймаут при создании платежа", status: 504 };
    }
    return {
      error: e instanceof Error ? e.message : "YooKassa: неизвестная ошибка",
      status: 502,
    };
  }
}

export async function getYookassaPaymentInfo(
  config: YookassaConfig,
  yookassaPaymentId: string,
): Promise<YookassaPaymentInfoResult> {
  const paymentId = yookassaPaymentId.trim();
  if (!paymentId) return { error: "Пустой paymentId", status: 400 };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), YOOKASSA_TIMEOUT_MS);
    const res = await fetch(
      `${YOOKASSA_API_BASE}/payments/${encodeURIComponent(paymentId)}`,
      {
        method: "GET",
        headers: {
          Authorization: toAuthHeader(config),
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timeout));

    const data = (await parseJsonSafe(res)) as YookassaApiPayment & Record<string, unknown>;
    if (!res.ok) {
      return {
        error: pickMessage(data, `YooKassa HTTP ${res.status}`),
        status: res.status,
      };
    }
    if (!data.id || !data.status) {
      return { error: "YooKassa вернула неполный ответ", status: 502 };
    }

    const amountValueRaw = data.amount?.value;
    const amountValue =
      amountValueRaw != null && Number.isFinite(Number(amountValueRaw))
        ? Number(amountValueRaw)
        : null;

    return {
      id: String(data.id),
      status: String(data.status),
      paid: Boolean(data.paid),
      confirmationUrl:
        data.confirmation?.confirmation_url &&
        String(data.confirmation.confirmation_url).trim()
          ? String(data.confirmation.confirmation_url)
          : null,
      paymentMethodType:
        data.payment_method?.type && String(data.payment_method.type).trim()
          ? String(data.payment_method.type)
          : null,
      amountValue,
      amountCurrency:
        data.amount?.currency && String(data.amount.currency).trim()
          ? String(data.amount.currency).toUpperCase()
          : null,
      raw: data,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { error: "YooKassa: таймаут при запросе статуса", status: 504 };
    }
    return {
      error: e instanceof Error ? e.message : "YooKassa: неизвестная ошибка",
      status: 502,
    };
  }
}
