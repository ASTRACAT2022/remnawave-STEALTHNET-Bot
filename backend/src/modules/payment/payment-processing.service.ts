import { prisma } from "../../db.js";
import type { Prisma } from "@prisma/client";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";

type PaymentSnapshot = {
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

type PaymentLookupInput = {
  paymentId?: string;
  orderId?: string;
  externalId?: string;
  provider?: string;
  resolvedExternalId?: string | null;
};

export type MarkPaymentResult =
  | { kind: "not_found" }
  | { kind: "already_final"; payment: PaymentSnapshot }
  | { kind: "paid_now"; payment: PaymentSnapshot }
  | { kind: "failed_now"; payment: PaymentSnapshot };

type PaymentMetadata = Record<string, unknown> & {
  activationAppliedAt?: string;
  activationInProgressAt?: string;
  activationAttempts?: number;
  activationLastError?: string | null;
};

function normalizeStr(value: string | undefined | null): string | null {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

function parseMetadata(raw: string | null): PaymentMetadata {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as PaymentMetadata;
  } catch {
    return {};
  }
}

async function findPaymentByLookup(
  tx: Prisma.TransactionClient,
  input: PaymentLookupInput
): Promise<PaymentSnapshot | null> {
  const paymentId = normalizeStr(input.paymentId);
  const orderId = normalizeStr(input.orderId);
  const externalId = normalizeStr(input.externalId);
  const provider = normalizeStr(input.provider);

  const select = {
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

  if (paymentId) {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, select: { ...select, provider: true } });
    if (!payment) return null;
    if (provider && payment.provider !== provider) return null;
    return {
      id: payment.id,
      status: payment.status,
      clientId: payment.clientId,
      amount: payment.amount,
      currency: payment.currency,
      tariffId: payment.tariffId,
      orderId: payment.orderId,
      externalId: payment.externalId,
      metadata: payment.metadata,
    };
  }

  if (orderId) {
    const payment = await tx.payment.findUnique({ where: { orderId }, select: { ...select, provider: true } });
    if (payment) {
      if (provider && payment.provider !== provider) return null;
      return {
        id: payment.id,
        status: payment.status,
        clientId: payment.clientId,
        amount: payment.amount,
        currency: payment.currency,
        tariffId: payment.tariffId,
        orderId: payment.orderId,
        externalId: payment.externalId,
        metadata: payment.metadata,
      };
    }
  }

  if (externalId) {
    const payment = await tx.payment.findFirst({
      where: {
        externalId,
        ...(provider ? { provider } : {}),
      },
      orderBy: { createdAt: "desc" },
      select,
    });
    return payment;
  }

  return null;
}

export async function markPaymentPaidByLookup(input: PaymentLookupInput): Promise<MarkPaymentResult> {
  return prisma.$transaction(async (tx) => {
    const payment = await findPaymentByLookup(tx, input);
    if (!payment) return { kind: "not_found" };

    if (payment.status !== "PENDING") {
      return { kind: "already_final", payment };
    }

    const resolvedExternalId = normalizeStr(input.resolvedExternalId) ?? normalizeStr(input.externalId) ?? payment.externalId;
    const update = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: "PAID",
        paidAt: new Date(),
        externalId: resolvedExternalId ?? null,
      },
    });

    if (update.count === 0) {
      const latest = await tx.payment.findUnique({
        where: { id: payment.id },
        select: {
          id: true,
          status: true,
          clientId: true,
          amount: true,
          currency: true,
          tariffId: true,
          orderId: true,
          externalId: true,
          metadata: true,
        },
      });
      return latest ? { kind: "already_final", payment: latest } : { kind: "not_found" };
    }

    const paid = await tx.payment.findUnique({
      where: { id: payment.id },
      select: {
        id: true,
        status: true,
        clientId: true,
        amount: true,
        currency: true,
        tariffId: true,
        orderId: true,
        externalId: true,
        metadata: true,
      },
    });
    if (!paid) return { kind: "not_found" };

    if (!paid.tariffId) {
      await tx.client.update({
        where: { id: paid.clientId },
        data: { balance: { increment: paid.amount } },
      });
    }

    return { kind: "paid_now", payment: paid };
  });
}

export async function markPaymentFailedByLookup(input: PaymentLookupInput): Promise<MarkPaymentResult> {
  return prisma.$transaction(async (tx) => {
    const payment = await findPaymentByLookup(tx, input);
    if (!payment) return { kind: "not_found" };

    if (payment.status !== "PENDING") {
      return { kind: "already_final", payment };
    }

    const resolvedExternalId = normalizeStr(input.resolvedExternalId) ?? normalizeStr(input.externalId) ?? payment.externalId;
    const update = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: "FAILED",
        externalId: resolvedExternalId ?? null,
      },
    });

    if (update.count === 0) {
      const latest = await tx.payment.findUnique({
        where: { id: payment.id },
        select: {
          id: true,
          status: true,
          clientId: true,
          amount: true,
          currency: true,
          tariffId: true,
          orderId: true,
          externalId: true,
          metadata: true,
        },
      });
      return latest ? { kind: "already_final", payment: latest } : { kind: "not_found" };
    }

    const failed = await tx.payment.findUnique({
      where: { id: payment.id },
      select: {
        id: true,
        status: true,
        clientId: true,
        amount: true,
        currency: true,
        tariffId: true,
        orderId: true,
        externalId: true,
        metadata: true,
      },
    });
    return failed ? { kind: "failed_now", payment: failed } : { kind: "not_found" };
  });
}

export async function processPaidPaymentPostActions(
  paymentId: string
): Promise<{
  activation: { attempted: boolean; ok: boolean; skippedReason?: string; error?: string };
  referral: { distributed: boolean; message: string };
}> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true, tariffId: true, metadata: true },
  });
  if (!payment) {
    return {
      activation: { attempted: false, ok: false, skippedReason: "payment_not_found" },
      referral: { distributed: false, message: "Payment not found" },
    };
  }
  if (payment.status !== "PAID") {
    return {
      activation: { attempted: false, ok: false, skippedReason: "payment_not_paid" },
      referral: { distributed: false, message: "Payment is not PAID" },
    };
  }

  let activation: { attempted: boolean; ok: boolean; skippedReason?: string; error?: string } = {
    attempted: false,
    ok: true,
    skippedReason: "no_tariff",
  };

  if (payment.tariffId) {
    const claim = await prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { metadata: true, status: true, tariffId: true },
      });
      if (!current || current.status !== "PAID" || !current.tariffId) {
        return { claimed: false, reason: "payment_not_paid_or_no_tariff" as const };
      }

      const meta = parseMetadata(current.metadata);
      if (typeof meta.activationAppliedAt === "string" && meta.activationAppliedAt.trim()) {
        return { claimed: false, reason: "already_applied" as const };
      }

      const inProgressAt = typeof meta.activationInProgressAt === "string" ? new Date(meta.activationInProgressAt) : null;
      const inProgressFresh = inProgressAt && Number.isFinite(inProgressAt.getTime()) && Date.now() - inProgressAt.getTime() < 10 * 60 * 1000;
      if (inProgressFresh) {
        return { claimed: false, reason: "already_in_progress" as const };
      }

      const nextMeta: PaymentMetadata = {
        ...meta,
        activationInProgressAt: new Date().toISOString(),
        activationAttempts: Number(meta.activationAttempts ?? 0) + 1,
      };
      await tx.payment.update({
        where: { id: paymentId },
        data: { metadata: JSON.stringify(nextMeta) },
      });
      return { claimed: true as const };
    });

    if (claim.claimed) {
      activation = { attempted: true, ok: false };
      const result = await activateTariffByPaymentId(paymentId);
      if (result.ok) {
        activation = { attempted: true, ok: true };
      } else {
        activation = { attempted: true, ok: false, error: result.error };
      }

      await prisma.$transaction(async (tx) => {
        const current = await tx.payment.findUnique({
          where: { id: paymentId },
          select: { metadata: true },
        });
        const meta = parseMetadata(current?.metadata ?? null);
        const nextMeta: PaymentMetadata = { ...meta };
        delete nextMeta.activationInProgressAt;
        if (result.ok) {
          nextMeta.activationAppliedAt = new Date().toISOString();
          nextMeta.activationLastError = null;
        } else {
          nextMeta.activationLastError = result.error;
        }
        await tx.payment.update({
          where: { id: paymentId },
          data: { metadata: JSON.stringify(nextMeta) },
        });
      });
    } else {
      activation = { attempted: false, ok: true, skippedReason: claim.reason };
    }
  }

  const referral = await distributeReferralRewards(paymentId);
  return { activation, referral };
}
