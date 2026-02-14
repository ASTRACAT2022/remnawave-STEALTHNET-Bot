import { Router } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyYooMoneySha1 } from "../yoomoney/yoomoney.service.js";
import { markPaymentPaidByLookup, processPaidPaymentPostActions } from "../payment/payment-processing.service.js";

export const yoomoneyWebhooksRouter = Router();

yoomoneyWebhooksRouter.post("/yoomoney", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const label = String(body.label ?? "").trim();
  const notificationType = String(body.notification_type ?? "").trim().toLowerCase();

  if (!label) {
    return res.status(400).json({ message: "Missing label" });
  }
  if (notificationType !== "p2p-incoming" && notificationType !== "card-incoming") {
    return res.status(200).json({ received: true });
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

  const unaccepted = String(body.unaccepted ?? "false").toLowerCase() === "true";
  const amountIncoming = Number(body.amount ?? "0");
  const withdrawAmountIncoming = Number(body.withdraw_amount ?? "0");
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

  const existing = await prisma.payment.findUnique({
    where: { orderId: label },
    select: { id: true, amount: true, provider: true },
  });
  if (!existing || existing.provider !== "yoomoney") {
    return res.status(200).json({ received: true });
  }

  // В ЮMoney комиссия может уменьшить amount (зачислено получателю),
  // поэтому дополнительно учитываем withdraw_amount (сколько списано у отправителя).
  const paidEnough =
    amountIncoming + 0.00001 >= existing.amount ||
    withdrawAmountIncoming + 0.00001 >= existing.amount;
  if (!paidEnough) {
    console.warn("[YooMoney Webhook] Incoming amount is less than expected", {
      label,
      expected: existing.amount,
      actual: amountIncoming,
      withdrawAmount: withdrawAmountIncoming,
    });
    return res.status(200).json({ received: true });
  }

  const paid = await markPaymentPaidByLookup({
    provider: "yoomoney",
    orderId: label,
    resolvedExternalId: String(body.operation_id ?? "") || null,
  });
  if (paid.kind === "not_found") {
    return res.status(200).json({ received: true });
  }

  const payment = paid.payment;
  if (paid.kind === "paid_now") {
    console.log("[YooMoney Webhook] Payment marked PAID", {
      paymentId: payment.id,
      orderId: payment.orderId,
      operationId: String(body.operation_id ?? "") || null,
    });
  }

  if ((paid.kind === "paid_now" || paid.kind === "already_final") && payment.status === "PAID") {
    const postActions = await processPaidPaymentPostActions(payment.id);
    if (!postActions.activation.ok && postActions.activation.attempted) {
      console.error("[YooMoney Webhook] Tariff activation failed", {
        paymentId: payment.id,
        error: postActions.activation.error,
      });
    }
  }

  return res.status(200).json({ received: true });
});
