import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { markPaymentPaid } from "../payment/mark-paid.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { getFreekassaOrderStatus, isFreekassaConfigured } from "./freekassa.service.js";

type FreekassaSyncItem = {
  paymentId: string;
  orderId: string;
  externalId: string | null;
  amount: number;
  status: "marked_paid" | "not_paid" | "failed";
  freekassaStatus?: number | null;
  error?: string;
};

export type FreekassaSyncResult =
  | {
      ok: true;
      checked: number;
      markedPaid: number;
      notPaid: number;
      failed: number;
      results: FreekassaSyncItem[];
    }
  | { ok: false; error: string };

export async function syncPendingFreekassaPayments(limit = 50): Promise<FreekassaSyncResult> {
  const config = await getSystemConfig();
  const freekassaConfig = {
    shopId: (config as { freekassaShopId?: string | null }).freekassaShopId ?? "",
    apiKey: (config as { freekassaApiKey?: string | null }).freekassaApiKey ?? "",
  };
  if (!isFreekassaConfigured(freekassaConfig)) {
    return { ok: false, error: "FreeKassa не настроена: нужен shop id и API key" };
  }

  const take = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const payments = await prisma.payment.findMany({
    where: {
      provider: "freekassa",
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      orderId: true,
      externalId: true,
      amount: true,
    },
  });

  const results: FreekassaSyncItem[] = [];
  for (const payment of payments) {
    const status = await getFreekassaOrderStatus({
      config: freekassaConfig,
      orderId: payment.externalId,
      paymentId: payment.orderId,
    });
    if (!status.ok) {
      results.push({
        paymentId: payment.id,
        orderId: payment.orderId,
        externalId: payment.externalId,
        amount: payment.amount,
        status: "failed",
        error: status.error,
      });
      continue;
    }

    if (!status.paid) {
      results.push({
        paymentId: payment.id,
        orderId: payment.orderId,
        externalId: payment.externalId,
        amount: payment.amount,
        status: "not_paid",
        freekassaStatus: status.status,
      });
      continue;
    }

    const mark = await markPaymentPaid(payment.id);
    if (!mark.ok) {
      results.push({
        paymentId: payment.id,
        orderId: payment.orderId,
        externalId: payment.externalId,
        amount: payment.amount,
        status: "failed",
        freekassaStatus: status.status,
        error: mark.error ?? "markPaymentPaid failed",
      });
      continue;
    }
    await recordPromoCodeUsageFromPayment(payment.id).catch((e) => {
      console.error("[FreeKassa Sync] promo usage:", e);
    });
    results.push({
      paymentId: payment.id,
      orderId: payment.orderId,
      externalId: payment.externalId,
      amount: payment.amount,
      status: "marked_paid",
      freekassaStatus: status.status,
    });
  }

  return {
    ok: true,
    checked: results.length,
    markedPaid: results.filter((r) => r.status === "marked_paid").length,
    notPaid: results.filter((r) => r.status === "not_paid").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
