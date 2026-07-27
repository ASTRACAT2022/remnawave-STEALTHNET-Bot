/**
 * Webhook FreeKassa.
 *
 * FreeKassa sends application/x-www-form-urlencoded form-data:
 * MERCHANT_ID, AMOUNT, intid, MERCHANT_ORDER_ID, SIGN, ...
 * Successful processing must return exactly "YES".
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import {
  isFreekassaWebhookIPAllowed,
  verifyFreekassaWebhookSignature,
} from "../freekassa/freekassa.service.js";
import { markPaymentPaid } from "../payment/mark-paid.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { recordWebhook, markOutcome, type WebhookOutcome } from "../webhook-inbox/webhook-inbox.service.js";

export const freekassaWebhooksRouter = Router();
export const freekassaFormParser = multer().none();

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

function serializeBody(body: unknown): string {
  try {
    return JSON.stringify(body ?? {});
  } catch {
    return String(body ?? "");
  }
}

export async function handleFreekassaWebhook(req: Request, res: Response) {
  const captured = await recordWebhook("freekassa", req, serializeBody(req.body));
  const respond = async (
    status: number,
    body: string,
    outcome: WebhookOutcome,
    opts?: { errorMessage?: string; paymentId?: string | null },
  ) => {
    await markOutcome(captured, status, outcome, opts);
    return res.status(status).send(body);
  };

  const sourceIp = requestIP(req);
  if (!isFreekassaWebhookIPAllowed(sourceIp)) {
    // Docker/nginx/proxy chains can hide the real FreeKassa IP if headers are
    // missing or rewritten. Do not reject solely by IP: Secret word 2 signature
    // verification below is the authoritative anti-forgery check.
    console.warn("[FreeKassa Webhook] Source IP is not in documented allowlist; continuing with signature verification", { sourceIp });
  }

  const config = await getSystemConfig();
  const merchantId = (config as { freekassaShopId?: string | null }).freekassaShopId?.trim();
  const secretWord2 = (config as { freekassaSecretWord2?: string | null }).freekassaSecretWord2?.trim();
  if (!merchantId || !secretWord2) {
    console.warn("[FreeKassa Webhook] FreeKassa secret word 2 is not configured");
    return respond(503, "FreeKassa webhook is not configured", "error", { errorMessage: "Secret word 2 is not configured" });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const incomingMerchantId = firstString(body.MERCHANT_ID);
  const amount = firstString(body.AMOUNT);
  const fkOrderId = firstString(body.intid);
  const orderId = firstString(body.MERCHANT_ORDER_ID);
  const signature = firstString(body.SIGN);
  const currencyId = firstString(body.CUR_ID);

  if (!incomingMerchantId || !amount || !orderId || !signature) {
    console.warn("[FreeKassa Webhook] Missing required fields", { bodyKeys: Object.keys(body) });
    return respond(400, "Bad request", "rejected_payload", { errorMessage: `Missing required fields: ${Object.keys(body).join(",")}` });
  }
  if (incomingMerchantId !== merchantId) {
    console.warn("[FreeKassa Webhook] Merchant mismatch", { incomingMerchantId });
    return respond(403, "Forbidden", "rejected_signature", { errorMessage: `Merchant mismatch: ${incomingMerchantId}` });
  }
  if (!verifyFreekassaWebhookSignature({ merchantId, amount, secretWord2, merchantOrderId: orderId, signature })) {
    console.warn("[FreeKassa Webhook] Invalid signature", { orderId });
    return respond(403, "Wrong sign", "rejected_signature", { errorMessage: `Invalid signature for order ${orderId}` });
  }

  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: "freekassa" },
    select: { id: true, amount: true, status: true, externalId: true },
  });
  if (!payment) {
    console.warn("[FreeKassa Webhook] Payment not found", { orderId, fkOrderId });
    return respond(200, "YES", "payment_not_found", { errorMessage: `Payment not found: ${orderId}` });
  }

  const receivedAmount = Number(amount);
  if (!Number.isFinite(receivedAmount) || Math.abs(receivedAmount - payment.amount) > 0.01) {
    console.warn("[FreeKassa Webhook] Amount mismatch", { paymentId: payment.id, expected: payment.amount, received: amount });
    return respond(400, "Amount mismatch", "rejected_payload", { paymentId: payment.id, errorMessage: `Amount mismatch: expected ${payment.amount}, received ${amount}` });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { externalId: fkOrderId || payment.externalId },
  });

  if (payment.status !== "PAID") {
    const result = await markPaymentPaid(payment.id);
    if (!result.ok) {
      console.error("[FreeKassa Webhook] mark paid failed", { paymentId: payment.id, error: result.error });
      return respond(500, "Payment processing error", "error", { paymentId: payment.id, errorMessage: result.error ?? "markPaymentPaid failed" });
    }
    await recordPromoCodeUsageFromPayment(payment.id).catch((e) => console.error("[FreeKassa Webhook] promo usage:", e));
  } else {
    await markOutcome(captured, 200, "payment_already_paid", { paymentId: payment.id });
    console.log("[FreeKassa Webhook] Payment already paid", { paymentId: payment.id, orderId, fkOrderId });
    return res.status(200).send("YES");
  }

  console.log("[FreeKassa Webhook] Payment accepted", { paymentId: payment.id, orderId, fkOrderId, currencyId });
  return respond(200, "YES", "accepted", { paymentId: payment.id });
}

freekassaWebhooksRouter.post("/freekassa", freekassaFormParser, handleFreekassaWebhook);
