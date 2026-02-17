import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { createNalogoReceipt } from "./nalogo.service.js";

type SystemConfig = Awaited<ReturnType<typeof getSystemConfig>>;

type ReceiptMeta = Record<string, unknown> & {
  nalogoReceiptUuid?: string;
  nalogoReceiptLastError?: string | null;
  nalogoReceiptLastAttemptAt?: string;
  nalogoReceiptInProgressAt?: string;
  nalogoReceiptAttempts?: number;
  nalogoReceiptNextRetryAt?: string;
};

const IN_PROGRESS_TTL_MS = 10 * 60 * 1000;
const RETRY_MIN_MS = 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

function parseMeta(raw: string | null): ReceiptMeta {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as ReceiptMeta;
  } catch {
    return {};
  }
}

function toIsoAfterMs(ms: number): string {
  return new Date(Date.now() + Math.max(0, ms)).toISOString();
}

function calcBackoffMs(attempts: number, retryable: boolean): number {
  const attempt = Math.max(1, Number.isFinite(attempts) ? Math.floor(attempts) : 1);
  const base = retryable ? RETRY_MIN_MS : 10 * 60 * 1000;
  const exp = Math.min(attempt - 1, 8); // cap growth
  const raw = base * Math.pow(2, exp);
  return Math.max(RETRY_MIN_MS, Math.min(RETRY_MAX_MS, raw));
}

function isConfigReady(config: SystemConfig): boolean {
  return Boolean(
    config.nalogoEnabled &&
      config.nalogoInn?.trim() &&
      config.nalogoPassword?.trim(),
  );
}

export type NalogoReceiptProcessStatus =
  | "created"
  | "failed"
  | "already_created"
  | "in_progress"
  | "retry_wait"
  | "not_paid_yookassa"
  | "not_configured"
  | "not_found";

export type NalogoReceiptProcessResult = {
  status: NalogoReceiptProcessStatus;
  paymentId: string;
  receiptUuid?: string;
  error?: string;
};

type ClaimResult =
  | { status: "claimed"; attempts: number }
  | {
      status:
        | "already_created"
        | "in_progress"
        | "retry_wait"
        | "not_paid_yookassa"
        | "not_found";
      receiptUuid?: string;
    };

type LockedPaymentRow = {
  id: string;
  provider: string | null;
  status: string;
  metadata: string | null;
};

export async function processNalogoReceiptForPayment(
  paymentId: string,
  preparedConfig?: SystemConfig,
  options?: { force?: boolean },
): Promise<NalogoReceiptProcessResult> {
  const config = preparedConfig ?? await getSystemConfig();
  const force = options?.force === true;
  if (!isConfigReady(config)) {
    return { status: "not_configured", paymentId };
  }

  const claim: ClaimResult = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedPaymentRow[]>`
      SELECT id, provider, status, metadata
      FROM payments
      WHERE id = ${paymentId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return { status: "not_found" as const };
    if (row.status !== "PAID" || row.provider !== "yookassa") {
      return { status: "not_paid_yookassa" as const };
    }

    const meta = parseMeta(row.metadata);
    if (typeof meta.nalogoReceiptUuid === "string" && meta.nalogoReceiptUuid.trim()) {
      return {
        status: "already_created" as const,
        receiptUuid: meta.nalogoReceiptUuid.trim(),
      };
    }

    const inProgressAt =
      typeof meta.nalogoReceiptInProgressAt === "string"
        ? new Date(meta.nalogoReceiptInProgressAt)
        : null;
    const freshInProgress =
      inProgressAt &&
      Number.isFinite(inProgressAt.getTime()) &&
      Date.now() - inProgressAt.getTime() < IN_PROGRESS_TTL_MS;
    if (freshInProgress && !force) {
      return { status: "in_progress" as const };
    }

    if (!force) {
      const nextRetryAt =
        typeof meta.nalogoReceiptNextRetryAt === "string"
          ? new Date(meta.nalogoReceiptNextRetryAt)
          : null;
      const waitRetry =
        nextRetryAt &&
        Number.isFinite(nextRetryAt.getTime()) &&
        nextRetryAt.getTime() > Date.now();
      if (waitRetry) {
        return { status: "retry_wait" as const };
      }
    }

    const next: ReceiptMeta = {
      ...meta,
      nalogoReceiptInProgressAt: new Date().toISOString(),
      nalogoReceiptAttempts: Number(meta.nalogoReceiptAttempts ?? 0) + 1,
    };
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
    return {
      status: "claimed" as const,
      attempts: Number(next.nalogoReceiptAttempts ?? 1),
    };
  });

  if (claim.status !== "claimed") {
    return {
      status: claim.status,
      paymentId,
      ...(claim.receiptUuid ? { receiptUuid: claim.receiptUuid } : {}),
    };
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      amount: true,
    },
  });
  if (!payment) {
    return { status: "not_found", paymentId };
  }

  const receiptName = "Пополнение баланса";

  const result = await createNalogoReceipt(
    {
      enabled: Boolean(config.nalogoEnabled),
      inn: config.nalogoInn,
      password: config.nalogoPassword,
      deviceId: config.nalogoDeviceId,
      timeoutSeconds: config.nalogoTimeout,
      proxyUrl: config.nalogoProxyUrl,
    },
    {
      name: receiptName,
      amountRub: payment.amount,
      quantity: 1,
    },
  );

  await prisma.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { metadata: true },
    });
    const meta = parseMeta(row?.metadata ?? null);
    const next: ReceiptMeta = { ...meta };
    delete next.nalogoReceiptInProgressAt;
    next.nalogoReceiptLastAttemptAt = new Date().toISOString();

    if ("receiptUuid" in result) {
      next.nalogoReceiptUuid = result.receiptUuid;
      next.nalogoReceiptLastError = null;
      delete next.nalogoReceiptNextRetryAt;
    } else {
      next.nalogoReceiptLastError = result.error;
      const attempts = Number(next.nalogoReceiptAttempts ?? claim.attempts ?? 1);
      next.nalogoReceiptNextRetryAt = toIsoAfterMs(
        calcBackoffMs(attempts, result.retryable),
      );
    }

    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
  });

  if ("receiptUuid" in result) {
    return { status: "created", paymentId, receiptUuid: result.receiptUuid };
  }
  return { status: "failed", paymentId, error: result.error };
}

export type NalogoRetryBatchResult = {
  configured: boolean;
  scanned: number;
  created: number;
  failed: number;
  skipped: number;
};

export async function processPendingNalogoReceipts(options?: {
  limit?: number;
}): Promise<NalogoRetryBatchResult> {
  const config = await getSystemConfig();
  if (!isConfigReady(config)) {
    return { configured: false, scanned: 0, created: 0, failed: 0, skipped: 0 };
  }

  const limitRaw = options?.limit ?? 100;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), 500)
    : 100;

  const rows = await prisma.payment.findMany({
    where: {
      provider: "yookassa",
      status: "PAID",
      OR: [
        { metadata: null },
        { metadata: "" },
        { metadata: { not: { contains: "\"nalogoReceiptUuid\"" } } },
      ],
    },
    select: { id: true },
    // Старые платежи обрабатываем первыми, чтобы не было starvation при постоянном новом потоке.
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  let created = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    const out = await processNalogoReceiptForPayment(row.id, config);
    if (out.status === "created") created += 1;
    else if (out.status === "failed") failed += 1;
    else skipped += 1;
  }

  return {
    configured: true,
    scanned: rows.length,
    created,
    failed,
    skipped,
  };
}
