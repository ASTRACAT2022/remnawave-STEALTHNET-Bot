/**
 * Вебхуки Platega.io — callback при смене статуса оплаты.
 * При успешной оплате обновляем платёж в БД, активируем тариф в Remnawave и начисляем реферальные.
 */

import { Router } from "express";
import { z } from "zod";
import {
  markPaymentFailedByLookup,
  markPaymentPaidByLookup,
  processPaidPaymentPostActions,
} from "../payment/payment-processing.service.js";

const callbackBodySchema = z.object({
  orderId: z.string().optional(),
  order_id: z.string().optional(),
  order: z.string().optional(),
  transactionId: z.string().optional(),
  transaction_id: z.string().optional(),
  id: z.string().optional(),
  status: z.string().optional(),
  state: z.string().optional(),
  paymentStatus: z.string().optional(),
  payment_status: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});

export const plategaWebhooksRouter = Router();

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

plategaWebhooksRouter.post("/platega", async (req, res) => {
  const parsed = callbackBodySchema.safeParse(req.body);
  const raw = parsed.success ? parsed.data : (req.body as Record<string, unknown>);
  const nested = (raw?.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : {}) as Record<string, unknown>;

  const orderId = pickFirstString(raw?.orderId, raw?.order_id, raw?.order, nested.orderId, nested.order_id, nested.order);
  const transactionId = pickFirstString(raw?.transactionId, raw?.transaction_id, raw?.id, nested.transactionId, nested.transaction_id, nested.id);
  const statusRaw = pickFirstString(raw?.status, raw?.state, raw?.paymentStatus, raw?.payment_status, nested.status, nested.state, nested.paymentStatus, nested.payment_status);
  const status = statusRaw?.toLowerCase();

  if (!orderId && !transactionId) {
    console.warn("[Platega Webhook] Missing orderId/transactionId", { keys: Object.keys(req.body || {}) });
    return res.status(400).json({ message: "Missing orderId or transactionId" });
  }

  const successStatuses = ["paid", "success", "succeeded", "completed", "successful", "approved"];
  const failedStatuses = ["failed", "error", "declined", "canceled", "cancelled", "expired", "rejected"];
  const isSuccess = successStatuses.some((s) => status?.includes(s));
  const isFailed = failedStatuses.some((s) => status?.includes(s));

  if (!isSuccess && !isFailed) {
    console.log("[Platega Webhook] Ignored status", { status: statusRaw, orderId, transactionId });
    return res.status(200).json({ received: true });
  }

  if (isFailed) {
    const failed = await markPaymentFailedByLookup({
      provider: "platega",
      orderId: orderId ?? undefined,
      externalId: transactionId ?? undefined,
      resolvedExternalId: transactionId ?? undefined,
    });
    if (failed.kind === "failed_now") {
      console.log("[Platega Webhook] Payment marked FAILED", {
        paymentId: failed.payment.id,
        orderId: failed.payment.orderId,
        transactionId: failed.payment.externalId,
      });
    }
    return res.status(200).json({ received: true });
  }

  const paid = await markPaymentPaidByLookup({
    provider: "platega",
    orderId: orderId ?? undefined,
    externalId: transactionId ?? undefined,
    resolvedExternalId: transactionId ?? undefined,
  });
  if (paid.kind === "not_found") {
    console.warn("[Platega Webhook] Payment not found", { orderId, transactionId });
    return res.status(200).json({ received: true });
  }

  if (paid.kind === "paid_now") {
    console.log("[Platega Webhook] Payment marked PAID", {
      paymentId: paid.payment.id,
      orderId: paid.payment.orderId,
      transactionId: paid.payment.externalId,
    });
  }

  if ((paid.kind === "paid_now" || paid.kind === "already_final") && paid.payment.status === "PAID") {
    const postActions = await processPaidPaymentPostActions(paid.payment.id);
    if (!postActions.activation.ok && postActions.activation.attempted) {
      console.error("[Platega Webhook] Tariff activation failed", {
        paymentId: paid.payment.id,
        error: postActions.activation.error,
      });
    } else if (postActions.activation.attempted && postActions.activation.ok) {
      console.log("[Platega Webhook] Tariff activated", { paymentId: paid.payment.id });
    }
  }

  return res.status(200).json({ received: true });
});
