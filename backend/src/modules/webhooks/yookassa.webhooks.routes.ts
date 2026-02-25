/**
 * Webhook YooKassa:
 * - проверка IP по официальным диапазонам YooKassa
 * - идемпотентное обновление статусов платежей yookassa
 * - активация тарифа + реферальные начисления
 * - автосоздание чека в налоговой (NaloGO), если включено
 */

import { Router } from "express";
import { BlockList, isIP } from "net";
import { prisma } from "../../db.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { getSystemConfig } from "../client/client.service.js";
import {
  getYookassaPaymentInfo,
  isYookassaConfigured,
  type YookassaConfig,
} from "../yookassa/yookassa.service.js";
import { processNalogoReceiptForPayment } from "../nalogo/nalogo-receipts.service.js";

export const yookassaWebhooksRouter = Router();

const YOOKASSA_EVENTS = new Set([
  "payment.succeeded",
  "payment.waiting_for_capture",
  "payment.canceled",
]);

const YOOKASSA_SUCCESS_STATUSES = new Set(["succeeded"]);
const YOOKASSA_FAILED_STATUSES = new Set(["canceled"]);

const YOOKASSA_ALLOWLIST = new BlockList();
YOOKASSA_ALLOWLIST.addSubnet("185.71.76.0", 27, "ipv4");
YOOKASSA_ALLOWLIST.addSubnet("185.71.77.0", 27, "ipv4");
YOOKASSA_ALLOWLIST.addSubnet("77.75.153.0", 25, "ipv4");
YOOKASSA_ALLOWLIST.addSubnet("77.75.154.128", 25, "ipv4");
YOOKASSA_ALLOWLIST.addAddress("77.75.156.11", "ipv4");
YOOKASSA_ALLOWLIST.addAddress("77.75.156.35", "ipv4");
YOOKASSA_ALLOWLIST.addSubnet("2a02:5180::", 32, "ipv6");

const CLOUDFLARE_TRUSTED = new BlockList();
CLOUDFLARE_TRUSTED.addSubnet("173.245.48.0", 20, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("103.21.244.0", 22, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("103.22.200.0", 22, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("103.31.4.0", 22, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("141.101.64.0", 18, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("108.162.192.0", 18, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("190.93.240.0", 20, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("188.114.96.0", 20, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("197.234.240.0", 22, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("198.41.128.0", 17, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("162.158.0.0", 15, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("104.16.0.0", 13, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("104.24.0.0", 14, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("172.64.0.0", 13, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("131.0.72.0", 22, "ipv4");
CLOUDFLARE_TRUSTED.addSubnet("2400:cb00::", 32, "ipv6");
CLOUDFLARE_TRUSTED.addSubnet("2606:4700::", 32, "ipv6");
CLOUDFLARE_TRUSTED.addSubnet("2803:f800::", 32, "ipv6");
CLOUDFLARE_TRUSTED.addSubnet("2405:b500::", 32, "ipv6");
CLOUDFLARE_TRUSTED.addSubnet("2405:8100::", 32, "ipv6");
CLOUDFLARE_TRUSTED.addSubnet("2a06:98c0::", 29, "ipv6");
CLOUDFLARE_TRUSTED.addSubnet("2c0f:f248::", 32, "ipv6");

type PaymentRow = {
  id: string;
  status: string;
  clientId: string;
  amount: number;
  currency: string;
  tariffId: string | null;
  orderId: string;
  externalId: string | null;
  metadata: string | null;
};

type Meta = Record<string, unknown> & {
  yookassaActivationAppliedAt?: string;
  yookassaActivationInProgressAt?: string;
  yookassaActivationAttempts?: number;
  yookassaActivationLastError?: string | null;
  nalogoReceiptUuid?: string;
  nalogoReceiptLastError?: string | null;
  nalogoReceiptLastAttemptAt?: string;
  nalogoReceiptInProgressAt?: string;
  nalogoReceiptAttempts?: number;
};

const PAYMENT_SELECT = {
  id: true,
  status: true,
  clientId: true,
  amount: true,
  currency: true,
  tariffId: true,
  orderId: true,
  externalId: true,
  metadata: true,
} as const;

function parseMeta(raw: string | null): Meta {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Meta;
  } catch {
    return {};
  }
}

function normalizeIp(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  if (value.startsWith("[") && value.includes("]")) {
    value = value.slice(1, value.indexOf("]"));
  }
  if (value.includes("%")) value = value.split("%", 1)[0]!;

  // IPv4 with port: "1.2.3.4:1234"
  if (value.includes(".") && value.includes(":") && !value.includes("::")) {
    const idx = value.lastIndexOf(":");
    if (idx > 0) {
      const maybePort = value.slice(idx + 1);
      if (/^\d+$/.test(maybePort)) value = value.slice(0, idx);
    }
  }

  // IPv4-mapped IPv6: "::ffff:1.2.3.4"
  if (value.toLowerCase().startsWith("::ffff:") && value.includes(".")) {
    value = value.slice(7);
  }

  return isIP(value) ? value : null;
}

function collectHeaderCandidateIps(req: import("express").Request): string[] {
  const candidates: string[] = [];
  const headers = [
    req.header("x-forwarded-for"),
    req.header("x-real-ip"),
    req.header("cf-connecting-ip"),
  ];
  for (const h of headers) {
    if (!h) continue;
    for (const part of h.split(",")) {
      const ip = normalizeIp(part);
      if (ip) candidates.push(ip);
    }
  }
  return candidates;
}

function collectCandidateIps(req: import("express").Request): string[] {
  const candidates = collectHeaderCandidateIps(req);
  const reqIp = normalizeIp(req.ip || "");
  if (reqIp) candidates.push(reqIp);
  const remote = normalizeIp(req.socket.remoteAddress || "");
  if (remote) candidates.push(remote);
  return [...new Set(candidates)];
}

function isPrivateOrLocalIp(ip: string): boolean {
  if (ip === "::1" || ip.toLowerCase() === "localhost") return true;
  if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) {
    return true;
  }
  if (ip.startsWith("172.")) {
    const parts = ip.split(".");
    const second = Number(parts[1] ?? "");
    if (Number.isFinite(second) && second >= 16 && second <= 31) return true;
  }
  return false;
}

function buildTrustedProxyList(raw: string | null | undefined): BlockList {
  const list = new BlockList();
  const value = (raw ?? "").trim();
  if (!value) return list;
  for (const part of value.split(",")) {
    const candidate = part.trim();
    if (!candidate) continue;
    const slashIdx = candidate.indexOf("/");
    if (slashIdx <= 0) continue;
    const addr = candidate.slice(0, slashIdx).trim();
    const prefixRaw = candidate.slice(slashIdx + 1).trim();
    const prefix = Number(prefixRaw);
    if (!Number.isFinite(prefix)) continue;
    const family = isIP(addr);
    try {
      if (family === 4) list.addSubnet(addr, prefix, "ipv4");
      if (family === 6) list.addSubnet(addr, prefix, "ipv6");
    } catch {
      // ignore invalid subnet
    }
  }
  return list;
}

function isTrustedProxyIp(ip: string, trusted: BlockList): boolean {
  return isPrivateOrLocalIp(ip) || CLOUDFLARE_TRUSTED.check(ip) || trusted.check(ip);
}

function shouldTrustForwardedHeaders(
  remoteIp: string | null,
  trustedProxyList: BlockList,
): boolean {
  if (!remoteIp) return true;
  return isTrustedProxyIp(remoteIp, trustedProxyList);
}

function resolveYookassaSourceIp(
  req: import("express").Request,
  trustedProxyList: BlockList,
): string | null {
  const remoteIp = normalizeIp(req.socket.remoteAddress || "");

  // Запрос пришел напрямую с публичного IP (не через доверенный proxy) — доверяем только remote.
  if (remoteIp && !isTrustedProxyIp(remoteIp, trustedProxyList)) {
    return remoteIp;
  }

  const headerCandidates = collectHeaderCandidateIps(req);
  if (shouldTrustForwardedHeaders(remoteIp, trustedProxyList)) {
    let lastHop: string | null = remoteIp;
    for (let i = headerCandidates.length - 1; i >= 0; i -= 1) {
      const candidate = headerCandidates[i]!;
      if (!lastHop || isTrustedProxyIp(lastHop, trustedProxyList)) {
        if (isTrustedProxyIp(candidate, trustedProxyList)) {
          lastHop = candidate;
          continue;
        }
        return candidate;
      }
      break;
    }

    if (lastHop && !isTrustedProxyIp(lastHop, trustedProxyList)) {
      return lastHop;
    }
  }

  return remoteIp ?? headerCandidates[0] ?? null;
}

function isYookassaIpAllowed(ip: string | null): boolean {
  if (!ip) return false;
  return YOOKASSA_ALLOWLIST.check(ip);
}

async function ensureTariffActivation(paymentId: string): Promise<void> {
  const claim = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { status: true, tariffId: true, metadata: true },
    });
    if (!row || row.status !== "PAID" || !row.tariffId) {
      return { claimed: false as const, reason: "not_paid_or_no_tariff" };
    }

    const meta = parseMeta(row.metadata);
    if (typeof meta.yookassaActivationAppliedAt === "string" && meta.yookassaActivationAppliedAt.trim()) {
      return { claimed: false as const, reason: "already_applied" };
    }

    const inProgressAt =
      typeof meta.yookassaActivationInProgressAt === "string"
        ? new Date(meta.yookassaActivationInProgressAt)
        : null;
    const freshInProgress =
      inProgressAt &&
      Number.isFinite(inProgressAt.getTime()) &&
      Date.now() - inProgressAt.getTime() < 10 * 60 * 1000;
    if (freshInProgress) {
      return { claimed: false as const, reason: "in_progress" };
    }

    const next: Meta = {
      ...meta,
      yookassaActivationInProgressAt: new Date().toISOString(),
      yookassaActivationAttempts: Number(meta.yookassaActivationAttempts ?? 0) + 1,
    };
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
    return { claimed: true as const, reason: "claimed" };
  });

  if (!claim.claimed) return;

  const activation = await activateTariffByPaymentId(paymentId);
  await prisma.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { metadata: true },
    });
    const meta = parseMeta(row?.metadata ?? null);
    const next: Meta = { ...meta };
    delete next.yookassaActivationInProgressAt;
    if (activation.ok) {
      next.yookassaActivationAppliedAt = new Date().toISOString();
      next.yookassaActivationLastError = null;
    } else {
      next.yookassaActivationLastError = activation.error;
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
  });

  if (activation.ok) {
    console.log("[YooKassa Webhook] Tariff activated", { paymentId });
  } else {
    console.error("[YooKassa Webhook] Tariff activation failed", {
      paymentId,
      error: activation.error,
    });
  }
}

async function ensureNalogoReceipt(paymentId: string): Promise<void> {
  const result = await processNalogoReceiptForPayment(paymentId);
  if (result.status === "created") {
    console.log("[YooKassa Webhook] NaloGO receipt created", {
      paymentId,
      receiptUuid: result.receiptUuid,
    });
  } else if (result.status === "failed") {
    console.error("[YooKassa Webhook] NaloGO receipt failed", {
      paymentId,
      error: result.error,
    });
  }
}

async function findPayment(
  yookassaPaymentId: string,
  metadataPaymentId: string | null,
): Promise<PaymentRow | null> {
  const byExternal = await prisma.payment.findFirst({
    where: { provider: "yookassa", externalId: yookassaPaymentId },
    select: PAYMENT_SELECT,
  });
  if (byExternal) return byExternal;

  if (metadataPaymentId?.trim()) {
    const byId = await prisma.payment.findFirst({
      where: { id: metadataPaymentId.trim(), provider: "yookassa" },
      select: PAYMENT_SELECT,
    });
    if (byId) return byId;
  }

  return null;
}

yookassaWebhooksRouter.get("/yookassa", (_req, res) => {
  res.status(200).json({ status: "ok", message: "YooKassa webhook is available" });
});

yookassaWebhooksRouter.post("/yookassa", async (req, res) => {
  try {
    const config = await getSystemConfig();
    const trustedProxyList = buildTrustedProxyList(config.yookassaTrustedProxyNetworks);
    const sourceIp = resolveYookassaSourceIp(req, trustedProxyList);
    if (!isYookassaIpAllowed(sourceIp)) {
      console.warn("[YooKassa Webhook] Forbidden IP", {
        sourceIp,
        candidates: collectCandidateIps(req),
      });
      return res.status(403).send("Forbidden");
    }

    const body = (req.body && typeof req.body === "object"
      ? req.body
      : null) as Record<string, unknown> | null;
    if (!body) return res.status(400).send("Bad request");

    const event = typeof body.event === "string" ? body.event : "";
    const object =
      body.object && typeof body.object === "object"
        ? (body.object as Record<string, unknown>)
        : null;
    const yookassaPaymentId =
      object && typeof object.id === "string" ? object.id.trim() : "";
    if (!event || !object || !yookassaPaymentId) {
      return res.status(400).send("Bad request");
    }

    if (!YOOKASSA_EVENTS.has(event)) {
      return res.status(200).send("OK");
    }

    const yookassaConfig: YookassaConfig = {
      shopId: config.yookassaShopId ?? "",
      secretKey: config.yookassaSecretKey ?? "",
      returnUrl: config.yookassaReturnUrl ?? "",
      defaultReceiptEmail: config.yookassaDefaultReceiptEmail ?? "",
      vatCode: config.yookassaVatCode ?? 1,
      paymentMode: config.yookassaPaymentMode ?? "full_payment",
      paymentSubject: config.yookassaPaymentSubject ?? "service",
    };

    // Как в bedolaga: перед обработкой пробуем получить актуальный статус через API.
    if (isYookassaConfigured(yookassaConfig)) {
      const remote = await getYookassaPaymentInfo(yookassaConfig, yookassaPaymentId);
      if (!("error" in remote)) {
        object.status = remote.status;
        object.paid = remote.paid;
        object.payment_method = remote.raw.payment_method ?? object.payment_method;
        object.amount = remote.raw.amount ?? object.amount;
        object.metadata = remote.raw.metadata ?? object.metadata;
      }
    }

    const status = typeof object.status === "string" ? object.status.toLowerCase() : "";
    const paidFlag =
      object.paid === true ||
      (typeof object.paid === "string" && object.paid.toLowerCase() === "true");
    const metadata =
      object.metadata && typeof object.metadata === "object"
        ? (object.metadata as Record<string, unknown>)
        : null;
    const metadataPaymentId =
      metadata && typeof metadata.paymentId === "string" ? metadata.paymentId : null;

    const payment = await findPayment(yookassaPaymentId, metadataPaymentId);
    if (!payment) {
      console.warn("[YooKassa Webhook] Payment not found", {
        yookassaPaymentId,
        metadataPaymentId,
        event,
        status,
      });
      return res.status(200).send("OK");
    }

    if (YOOKASSA_FAILED_STATUSES.has(status)) {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", externalId: yookassaPaymentId },
      });
      return res.status(200).send("OK");
    }

    const isSuccess = YOOKASSA_SUCCESS_STATUSES.has(status) && (paidFlag || status === "succeeded");
    if (!isSuccess) return res.status(200).send("OK");

    const paidNow = !payment.tariffId
      ? await prisma.$transaction(async (tx) => {
          const upd = await tx.payment.updateMany({
            where: { id: payment.id, status: "PENDING" },
            data: { status: "PAID", paidAt: new Date(), externalId: yookassaPaymentId },
          });
          if (upd.count > 0) {
            await tx.client.update({
              where: { id: payment.clientId },
              data: { balance: { increment: payment.amount } },
            });
          }
          return upd.count > 0;
        })
      : (await prisma.payment.updateMany({
          where: { id: payment.id, status: "PENDING" },
          data: { status: "PAID", paidAt: new Date(), externalId: yookassaPaymentId },
        })).count > 0;

    if (payment.tariffId) {
      // Безопасный ретрай: даже если paidNow=false (повторный webhook), активация выполнится только 1 раз.
      await ensureTariffActivation(payment.id);
    }
    await distributeReferralRewards(payment.id).catch((e) => {
      console.error("[YooKassa Webhook] Referral distribution error", {
        paymentId: payment.id,
        error: e,
      });
    });
    await ensureNalogoReceipt(payment.id).catch((e) => {
      console.error("[YooKassa Webhook] NaloGO receipt error", {
        paymentId: payment.id,
        error: e,
      });
    });

    console.log("[YooKassa Webhook] Payment processed", {
      paymentId: payment.id,
      yookassaPaymentId,
      status,
      paidNow,
      tariff: Boolean(payment.tariffId),
    });

    return res.status(200).send("OK");
  } catch (e) {
    console.error("[YooKassa Webhook] Error:", e);
    // 200 чтобы провайдер не устраивал бесконечные ретраи на наши внутренние ошибки
    return res.status(200).send("OK");
  }
});
