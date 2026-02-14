/**
 * Вебхуки Platega.io — callback при смене статуса оплаты.
 * При успешной оплате обновляем платёж в БД, активируем тариф в Remnawave и начисляем реферальные.
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";

const callbackBodySchema = z.object({
  orderId: z.string().optional(),
  order_id: z.string().optional(),
  transactionId: z.string().optional(),
  transaction_id: z.string().optional(),
  status: z.string().optional(),
  state: z.string().optional(),
});

export const plategaWebhooksRouter = Router();

plategaWebhooksRouter.post("/platega", async (req, res) => {
  const parsed = callbackBodySchema.safeParse(req.body);
  const raw = parsed.success ? parsed.data : (req.body as Record<string, unknown>);

  const orderId = (raw?.orderId ?? raw?.order_id) as string | undefined;
  const status = ((raw?.status ?? raw?.state) as string)?.toLowerCase();

  if (!orderId?.trim()) {
    console.warn("[Platega Webhook] Missing orderId", { keys: Object.keys(req.body || {}) });
    return res.status(400).json({ message: "Missing orderId" });
  }

  const payment = await prisma.payment.findUnique({
    where: { orderId: orderId.trim() },
    select: { id: true, status: true, clientId: true, amount: true, currency: true, tariffId: true },
  });

  if (!payment) {
    console.warn("[Platega Webhook] Payment not found", { orderId });
    return res.status(200).json({ received: true });
  }

  const successStatuses = ["paid", "success", "completed", "successful"];
  const isSuccess = successStatuses.some((s) => status?.includes(s));

  if (isSuccess && payment.status === "PENDING") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date() },
    });
    console.log("[Platega Webhook] Payment marked PAID", { orderId, paymentId: payment.id });

    // Активируем тариф в Remnawave
    if (payment.tariffId) {
      const activation = await activateTariffByPaymentId(payment.id);
      if (activation.ok) {
        console.log("[Platega Webhook] Tariff activated", { paymentId: payment.id });
      } else {
        console.error("[Platega Webhook] Tariff activation failed", { paymentId: payment.id, error: (activation as { error: string }).error });
      }
    }

    // Реферальные начисления
    await distributeReferralRewards(payment.id).catch((e) => {
      console.error("[Platega Webhook] Referral distribution error", { paymentId: payment.id, error: e });
    });
  }

  return res.status(200).json({ received: true });
});
