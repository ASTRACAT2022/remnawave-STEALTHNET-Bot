import { Router } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { verifyYooMoneySha1 } from "../yoomoney/yoomoney.service.js";

export const yoomoneyWebhooksRouter = Router();

yoomoneyWebhooksRouter.post("/yoomoney", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const label = String(body.label ?? "").trim();

  if (!label) {
    return res.status(400).json({ message: "Missing label" });
  }

  const config = await getSystemConfig();
  const secret = config.yoomoneyNotificationSecret ?? "";
  if (!secret.trim()) {
    return res.status(503).json({ message: "YooMoney webhook secret is not configured" });
  }

  if (!verifyYooMoneySha1(body, secret)) {
    console.warn("[YooMoney Webhook] Invalid sha1_hash", { label });
    return res.status(403).json({ message: "Invalid signature" });
  }

  const payment = await prisma.payment.findUnique({
    where: { orderId: label },
    select: { id: true, status: true, amount: true, tariffId: true },
  });

  if (!payment) {
    return res.status(200).json({ received: true });
  }

  const unaccepted = String(body.unaccepted ?? "false").toLowerCase() === "true";
  const amountIncoming = Number(body.amount ?? "0");
  const currencyIncoming = String(body.currency ?? "");

  if (currencyIncoming !== "643") {
    console.warn("[YooMoney Webhook] Unsupported currency", { label, currencyIncoming });
    return res.status(200).json({ received: true });
  }
  if (!Number.isFinite(amountIncoming) || amountIncoming <= 0) {
    console.warn("[YooMoney Webhook] Invalid amount", { label, amountIncoming });
    return res.status(200).json({ received: true });
  }
  if (unaccepted) {
    console.warn("[YooMoney Webhook] Transfer unaccepted", { label });
    return res.status(200).json({ received: true });
  }
  if (amountIncoming + 0.00001 < payment.amount) {
    console.warn("[YooMoney Webhook] Incoming amount is less than expected", {
      label,
      expected: payment.amount,
      actual: amountIncoming,
    });
    return res.status(200).json({ received: true });
  }

  if (payment.status === "PENDING") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date(), externalId: String(body.operation_id ?? "") || null },
    });

    if (payment.tariffId) {
      const activation = await activateTariffByPaymentId(payment.id);
      if (!activation.ok) {
        console.error("[YooMoney Webhook] Tariff activation failed", {
          paymentId: payment.id,
          error: (activation as { error: string }).error,
        });
      }
    }

    await distributeReferralRewards(payment.id).catch((e) => {
      console.error("[YooMoney Webhook] Referral distribution error", { paymentId: payment.id, error: e });
    });
  }

  return res.status(200).json({ received: true });
});
