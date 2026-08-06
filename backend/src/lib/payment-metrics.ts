/**
 * Удобные обёртки для инструментирования платёжных webhook'ов.
 * Идемпотентны, безопасны: метрики — это side-effect, если упадут
 * счётчики, основной flow не должен пострадать. Поэтому все вызовы
 * метрик обёрнуты в try/catch.
 */

import {
  paymentWebhookTotal,
  paymentProcessedTotal,
  paymentFailedTotal,
  paymentProcessingDuration,
  tariffActivationsTotal,
  referralRewardsTotal,
  giftActivationsTotal,
} from "./metrics.js";

export type PaymentProvider =
  | "freekassa"
  | "heleket"
  | "telegram_stars"
  | "yoomoney"
  | "yookassa"
  | "platega"
  | "cryptopay"
  | "lava"
  | "lavatop"
  | "overpay"
  | "remna";

export type PaymentProduct =
  | "topup"
  | "tariff"
  | "proxy"
  | "singbox"
  | "wdtt"
  | "extra_option"
  | "unknown";

export type PaymentOutcome =
  | "received"
  | "signature_invalid"
  | "bad_payload"
  | "rejected_payload"
  | "rejected_signature"
  | "rejected_ip"
  | "payment_not_found"
  | "amount_mismatch"
  | "error"
  | "processed"
  | "ignored"
  | "payment_already_paid";

function safeInc(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    // Метрики не должны ронять основной flow. Логируем и едем дальше.
    console.error("[metrics] counter inc failed:", e instanceof Error ? e.message : e);
  }
}

/** Событие «получили webhook». Вызывать СРАЗУ на входе в обработчик. */
export function recordPaymentWebhookReceived(provider: PaymentProvider): void {
  safeInc(() => paymentWebhookTotal.inc({ provider, outcome: "received" }));
}

/** Финальный исход обработки webhook'а. Вызывать в самом конце (любой ветке).
 *  Принимает любой строковый outcome (в т.ч. WebhookOutcome из webhook-inbox)
 *  — маппинг устойчив к расширениям.
 */
export function recordPaymentWebhookOutcome(provider: PaymentProvider, outcome: string): void {
  // Фильтруем к известным values — чтобы случайная строка не взорвала cardinality
  const known: PaymentOutcome[] = [
    "received",
    "signature_invalid",
    "bad_payload",
    "rejected_payload",
    "rejected_signature",
    "rejected_ip",
    "payment_not_found",
    "amount_mismatch",
    "error",
    "processed",
    "ignored",
    "payment_already_paid",
  ];
  // Всё что не в known — схлопываем в "ignored" (чтобы новые варианты из
  // webhook-inbox не плодили кардинальность)
  const safe = (known as string[]).includes(outcome) ? outcome : "ignored";
  safeInc(() => paymentWebhookTotal.inc({ provider, outcome: safe as PaymentOutcome }));
}

/** Платёж успешно обработан и привёл к активации продукта. */
export function recordPaymentProcessed(provider: PaymentProvider, product: PaymentProduct, seconds: number): void {
  safeInc(() => {
    paymentProcessedTotal.inc({ provider, product });
    paymentProcessingDuration.observe({ provider, product }, seconds);
  });
}

/** Платёж не обработан (signature / amount / processing error). */
export function recordPaymentFailed(provider: PaymentProvider, reason: string): void {
  safeInc(() => paymentFailedTotal.inc({ provider, reason }));
}

/** Извлечь тип продукта из строки payment provider + полей платежа. */
export function deriveProduct(input: {
  tariffId?: string | null;
  proxyTariffId?: string | null;
  singboxTariffId?: string | null;
  wdttTariffId?: string | null;
  metadata?: string | null;
}): PaymentProduct {
  if (input.proxyTariffId) return "proxy";
  if (input.singboxTariffId) return "singbox";
  if (input.wdttTariffId) return "wdtt";
  if (input.tariffId) return "tariff";
  if (input.metadata?.includes("\"extraOption\"")) return "extra_option";
  return "topup";
}

/** Обёртка для замера времени обработки webhook'а целиком. */
export function startPaymentTimer(): (product: PaymentProduct) => number {
  const start = process.hrtime.bigint();
  return (product: PaymentProduct) => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    // Не вызываем recordPaymentProcessed здесь — caller сделает это явно
    // после успешной активации, чтобы не путать «пришёл webhook» с «обработан».
    void product;
    return seconds;
  };
}

// ── Бизнес-счётчики (для использования в payment/tariff/gift/referral сервисах) ──

export function recordTariffActivation(
  tariffType: "vpn" | "proxy" | "singbox" | "wdtt",
  outcome: "success" | "failed" | "already_active",
): void {
  safeInc(() => tariffActivationsTotal.inc({ tariff_type: tariffType, outcome }));
}

export function recordReferralReward(outcome: "success" | "failed" | "skipped"): void {
  safeInc(() => referralRewardsTotal.inc({ outcome }));
}

export function recordGiftActivation(outcome: "success" | "failed" | "not_found" | "expired" | "already_used"): void {
  safeInc(() => giftActivationsTotal.inc({ outcome }));
}
