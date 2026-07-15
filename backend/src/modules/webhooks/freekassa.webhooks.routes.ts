/**
 * Webhook FreeKassa.
 *
 * FreeKassa sends application/x-www-form-urlencoded form-data:
 * MERCHANT_ID, AMOUNT, intid, MERCHANT_ORDER_ID, SIGN, ...
 * Successful processing must return exactly "YES".
 */

import { Router, Request, Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import {
  isFreekassaWebhookIPAllowed,
  verifyFreekassaWebhookSignature,
} from "../freekassa/freekassa.service.js";
import { markPaymentPaid } from "../payment/mark-paid.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";

export const freekassaWebhooksRouter = Router();

function firstString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function requestIP(req: Request): string {
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]?.trim() ?? "";
  return (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

freekassaWebhooksRouter.post("/freekassa", async (req: Request, res: Response) => {
  const sourceIp = requestIP(req);
  if (!isFreekassaWebhookIPAllowed(sourceIp)) {
    console.warn("[FreeKassa Webhook] Rejected IP", { sourceIp });
    return res.status(403).send("Forbidden");
  }

  const config = await getSystemConfig();
  const merchantId = (config as { freekassaShopId?: string | null }).freekassaShopId?.trim();
  const secretWord2 = (config as { freekassaSecretWord2?: string | null }).freekassaSecretWord2?.trim();
  if (!merchantId || !secretWord2) {
    console.warn("[FreeKassa Webhook] FreeKassa secret word 2 is not configured");
    return res.status(503).send("FreeKassa webhook is not configured");
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const incomingMerchantId = firstString(body.MERCHANT_ID);
  const amount = firstString(body.AMOUNT);
  const fkOrderId = firstString(body.intid);
  const orderId = firstString(body.MERCHANT_ORDER_ID);
  const signature = firstString(body.SIGN);
  const currencyId = firstString(body.CUR_ID);

  if (!incomingMerchantId || !amount || !orderId || !signature) {
    console.warn("[FreeKassa Webhook] Missing required fields");
    return res.status(400).send("Bad request");
  }
  if (incomingMerchantId !== merchantId) {
    console.warn("[FreeKassa Webhook] Merchant mismatch", { incomingMerchantId });
    return res.status(403).send("Forbidden");
  }
  if (!verifyFreekassaWebhookSignature({ merchantId, amount, secretWord2, merchantOrderId: orderId, signature })) {
    console.warn("[FreeKassa Webhook] Invalid signature", { orderId });
    return res.status(403).send("Wrong sign");
  }

  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: "freekassa" },
    select: { id: true, amount: true, status: true, externalId: true },
  });
  if (!payment) {
    console.warn("[FreeKassa Webhook] Payment not found", { orderId, fkOrderId });
    return res.status(200).send("YES");
  }

  const receivedAmount = Number(amount);
  if (!Number.isFinite(receivedAmount) || Math.abs(receivedAmount - payment.amount) > 0.01) {
    console.warn("[FreeKassa Webhook] Amount mismatch", { paymentId: payment.id, expected: payment.amount, received: amount });
    return res.status(400).send("Amount mismatch");
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { externalId: fkOrderId || payment.externalId },
  });

  if (payment.status !== "PAID") {
    await recordPromoCodeUsageFromPayment(payment.id).catch((e) => console.error("[FreeKassa Webhook] promo usage:", e));
    const result = await markPaymentPaid(payment.id);
    if (!result.ok) {
      console.error("[FreeKassa Webhook] mark paid failed", { paymentId: payment.id, error: result.error });
      return res.status(500).send("Payment processing error");
    }
  }

  console.log("[FreeKassa Webhook] Payment accepted", { paymentId: payment.id, orderId, fkOrderId, currencyId });
  return res.status(200).send("YES");
});
