import cron from "node-cron";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { getYookassaPaymentStatus } from "../yookassa/yookassa.service.js";
import { getPlategaTransactionStatus } from "../platega/platega.service.js";
import { markPaymentPaid } from "./mark-paid.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyTariffActivated } from "../notification/telegram-notify.service.js";

const RETRY_WINDOW_MS = 20 * 60 * 1000;
const ATTEMPT_GAP_MS = 2 * 60 * 1000;
const LOOKBACK_MS = 2 * 60 * 60 * 1000;

const SUCCESS_STATUSES = new Set(["succeeded", "paid", "success", "confirmed", "completed", "successful", "approved"]);
const FAILED_STATUSES = new Set(["canceled", "cancelled", "failed", "declined", "rejected", "error", "expired"]);

type RetryMeta = Record<string, unknown> & {
  businessRetry?: {
    firstSeenAt?: string;
    lastCheckedAt?: string;
    attempts?: number;
    providerStatus?: string;
    lastError?: string | null;
    finalAt?: string;
    finalReason?: string;
    activationOkAt?: string;
    activationFinalAt?: string;
    activationLastError?: string | null;
  };
};

function parseMeta(raw: string | null): RetryMeta {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as RetryMeta;
  } catch {
    return {};
  }
}

function business(meta: RetryMeta): NonNullable<RetryMeta["businessRetry"]> {
  return meta.businessRetry && typeof meta.businessRetry === "object" ? meta.businessRetry : {};
}

function due(meta: RetryMeta): boolean {
  const br = business(meta);
  if (br.finalAt) return false;
  const last = br.lastCheckedAt ? new Date(br.lastCheckedAt).getTime() : 0;
  return !Number.isFinite(last) || Date.now() - last >= ATTEMPT_GAP_MS;
}

async function updateMeta(paymentId: string, patch: Partial<NonNullable<RetryMeta["businessRetry"]>>) {
  const row = await prisma.payment.findUnique({ where: { id: paymentId }, select: { metadata: true } });
  const meta = parseMeta(row?.metadata ?? null);
  const prev = business(meta);
  meta.businessRetry = {
    ...prev,
    firstSeenAt: prev.firstSeenAt ?? new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    attempts: Number(prev.attempts ?? 0) + 1,
    ...patch,
  };
  await prisma.payment.update({ where: { id: paymentId }, data: { metadata: JSON.stringify(meta) } });
}

function paymentAgeMs(payment: { createdAt: Date; paidAt?: Date | null }) {
  return Date.now() - (payment.paidAt ?? payment.createdAt).getTime();
}

async function finalizePendingPayments() {
  const config = await getSystemConfig();
  const pending = await prisma.payment.findMany({
    where: {
      status: "PENDING",
      provider: { in: ["yookassa", "platega"] },
      createdAt: { gte: new Date(Date.now() - LOOKBACK_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  for (const payment of pending) {
    const meta = parseMeta(payment.metadata);
    if (!due(meta)) continue;

    const age = paymentAgeMs(payment);
    let status: string | null = null;
    let error: string | null = null;

    if (payment.provider === "yookassa") {
      const shopId = (config.yookassaShopId ?? "").trim();
      const secretKey = (config.yookassaSecretKey ?? "").trim();
      if (!payment.externalId) {
        error = "YooKassa externalId is missing";
      } else {
        const result = await getYookassaPaymentStatus({ shopId, secretKey, paymentId: payment.externalId });
        if (result.ok) status = result.status.toLowerCase();
        else error = result.error;
      }
    } else if (payment.provider === "platega") {
      const merchantId = (config.plategaMerchantId ?? "").trim();
      const secret = (config.plategaSecret ?? "").trim();
      if (!payment.externalId) {
        error = "Platega externalId is missing";
      } else {
        const result = await getPlategaTransactionStatus({ merchantId, secret }, payment.externalId);
        if ("error" in result) error = result.error;
        else status = result.status.toLowerCase();
      }
    }

    if (status && SUCCESS_STATUSES.has(status)) {
      await updateMeta(payment.id, { providerStatus: status, lastError: null });
      const result = await markPaymentPaid(payment.id);
      if (!result.ok) {
        await updateMeta(payment.id, { lastError: result.error ?? "markPaymentPaid failed" });
      }
      continue;
    }

    if (age >= RETRY_WINDOW_MS && (error || (status && FAILED_STATUSES.has(status)))) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", metadata: JSON.stringify({
          ...meta,
          businessRetry: {
            ...business(meta),
            firstSeenAt: business(meta).firstSeenAt ?? new Date(payment.createdAt).toISOString(),
            lastCheckedAt: new Date().toISOString(),
            attempts: Number(business(meta).attempts ?? 0) + 1,
            providerStatus: status ?? undefined,
            lastError: error,
            finalAt: new Date().toISOString(),
            finalReason: error ? "provider_api_error_timeout" : "provider_terminal_failed",
          },
        }) },
      });
      console.warn("[payment-finalizer] Payment finalized as FAILED after retry window", { paymentId: payment.id, provider: payment.provider, status, error });
      continue;
    }

    await updateMeta(payment.id, {
      providerStatus: status ?? undefined,
      lastError: error,
    });
  }
}

function hasCustomBuild(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj?.customBuild != null && typeof obj.customBuild === "object";
  } catch {
    return false;
  }
}

async function retryPaidBusinessLogic() {
  const paid = await prisma.payment.findMany({
    where: {
      status: "PAID",
      paidAt: { gte: new Date(Date.now() - LOOKBACK_MS) },
      OR: [
        { tariffId: { not: null }, subscriptionId: null },
        { metadata: { contains: "customBuild" } },
      ],
    },
    orderBy: { paidAt: "asc" },
    take: 100,
  });

  for (const payment of paid) {
    const meta = parseMeta(payment.metadata);
    const br = business(meta);
    if (br.activationOkAt || br.activationFinalAt) continue;
    if (!due(meta)) continue;

    if (payment.subscriptionId) {
      await updateMeta(payment.id, { activationOkAt: new Date().toISOString(), activationLastError: null });
      continue;
    }

    const age = paymentAgeMs(payment);
    let result: { ok: boolean; error?: string; status?: number };
    if (payment.tariffId || hasCustomBuild(payment.metadata)) {
      result = await activateTariffByPaymentId(payment.id);
    } else {
      continue;
    }

    if (result.ok) {
      await updateMeta(payment.id, { activationOkAt: new Date().toISOString(), activationLastError: null });
      await distributeReferralRewards(payment.id).catch(() => {});
      await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
      continue;
    }

    const error = result.error ?? "activation failed";
    if (age >= RETRY_WINDOW_MS) {
      await updateMeta(payment.id, {
        activationLastError: error,
        activationFinalAt: new Date().toISOString(),
        finalReason: "business_activation_timeout",
      });
      console.error("[payment-finalizer] Business activation failed after retry window", { paymentId: payment.id, error });
      continue;
    }

    await updateMeta(payment.id, { activationLastError: error });
  }
}

export function startPaymentFinalizerScheduler() {
  cron.schedule("* * * * *", async () => {
    try {
      await finalizePendingPayments();
      await retryPaidBusinessLogic();
    } catch (e) {
      console.error("[payment-finalizer] Cron error:", e);
    }
  });
}
