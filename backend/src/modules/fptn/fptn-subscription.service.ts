import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import {
  extractFptnAccessKey,
  extractFptnExpireAt,
  extractFptnStatus,
  extractFptnUsername,
  fptnExtendSubscription,
  fptnGetAccessKey,
  fptnGetUserDetails,
  fptnRotateAccessKey,
  fptnUpsertUser,
  isFptnConfigured,
  isFptnNotFoundError,
  resolveFptnConfig,
  unwrapFptnPayload,
} from "./fptn.client.js";

export type FptnClientIdentity = {
  id: string;
  email: string | null;
  telegramId: string | null;
};

export type FptnIssueReason = "paid" | "trial" | "promo";

export type FptnNormalizedSubscription = {
  source: "fptn";
  username: string;
  status: string;
  expireAt: string | null;
  subscriptionUrl: string | null;
  accessKey: string | null;
  issuedOnlyAfterPayment: true;
  rawUser: unknown;
  rawAccessKey: unknown;
};

export type FptnLookupResult =
  | { ok: true; subscription: FptnNormalizedSubscription | null }
  | { ok: false; error: string; status: number };

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildFptnUsernameForClient(
  client: FptnClientIdentity,
  usernamePrefix: string,
): string {
  const prefix = sanitizeSegment(usernamePrefix) || "fptn";
  const byTelegram = client.telegramId ? `tg_${sanitizeSegment(client.telegramId)}` : "";
  const byEmail = client.email ? `mail_${sanitizeSegment(client.email.split("@")[0] ?? "")}` : "";
  const byClientId = `client_${sanitizeSegment(client.id.slice(-12)) || sanitizeSegment(client.id) || "user"}`;
  const suffix = byTelegram || byEmail || byClientId;
  return `${prefix}_${suffix}`.slice(0, 63);
}

async function hasPaidTariffHistory(clientId: string): Promise<boolean> {
  const count = await prisma.payment.count({
    where: {
      clientId,
      status: "PAID",
      tariffId: { not: null },
    },
  });
  return count > 0;
}

export async function resolveLatestPaidTariffName(clientId: string): Promise<string | null> {
  const latest = await prisma.payment.findFirst({
    where: {
      clientId,
      status: "PAID",
      tariffId: { not: null },
    },
    orderBy: [
      { paidAt: "desc" },
      { createdAt: "desc" },
    ],
    select: {
      tariff: {
        select: { name: true },
      },
    },
  });
  return latest?.tariff?.name?.trim() || null;
}

function normalizeFptnSubscription(params: {
  username: string;
  userData: unknown;
  accessKeyData: unknown;
}): FptnNormalizedSubscription {
  const username = extractFptnUsername(params.userData) ?? params.username;
  const accessKey = extractFptnAccessKey(params.accessKeyData);
  const expireAt = extractFptnExpireAt(params.userData);
  const status = extractFptnStatus(params.userData) ?? (accessKey ? "ACTIVE" : "INACTIVE");
  return {
    source: "fptn",
    username,
    status,
    expireAt,
    subscriptionUrl: accessKey,
    accessKey,
    issuedOnlyAfterPayment: true,
    rawUser: params.userData,
    rawAccessKey: params.accessKeyData,
  };
}

export async function getFptnSubscriptionForClient(client: FptnClientIdentity): Promise<FptnLookupResult> {
  if (!await hasPaidTariffHistory(client.id)) {
    return { ok: true, subscription: null };
  }

  const systemConfig = await getSystemConfig();
  const fptnConfig = resolveFptnConfig(systemConfig);
  if (!isFptnConfigured(fptnConfig)) {
    return { ok: true, subscription: null };
  }

  const username = buildFptnUsernameForClient(client, fptnConfig.usernamePrefix);
  const userRes = await fptnGetUserDetails(fptnConfig, username);
  if (userRes.error) {
    if (isFptnNotFoundError(userRes.status, userRes.error)) {
      return { ok: true, subscription: null };
    }
    return { ok: false, error: userRes.error, status: userRes.status >= 400 ? userRes.status : 500 };
  }

  const accessKeyRes = await fptnGetAccessKey(fptnConfig, username);
  if (accessKeyRes.error && !isFptnNotFoundError(accessKeyRes.status, accessKeyRes.error)) {
    return { ok: false, error: accessKeyRes.error, status: accessKeyRes.status >= 400 ? accessKeyRes.status : 500 };
  }

  return {
    ok: true,
    subscription: normalizeFptnSubscription({
      username,
      userData: userRes.data ?? null,
      accessKeyData: accessKeyRes.data ?? null,
    }),
  };
}

export async function activatePaidFptnForClient(
  client: FptnClientIdentity,
  durationDays: number,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  return issueFptnForClient(client, durationDays, "paid");
}

function shouldIssueFptnForReason(
  config: Awaited<ReturnType<typeof getSystemConfig>>,
  reason: FptnIssueReason,
): boolean {
  if (reason === "paid") return config.fptnIssueOnPaidTariff !== false;
  if (reason === "trial") return config.fptnIssueOnTrial === true;
  if (reason === "promo") return config.fptnIssueOnPromo === true;
  return false;
}

export async function issueFptnForClient(
  client: FptnClientIdentity,
  durationDays: number,
  reason: FptnIssueReason,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const systemConfig = await getSystemConfig();
  if (!shouldIssueFptnForReason(systemConfig, reason)) {
    return { ok: true };
  }
  const fptnConfig = resolveFptnConfig(systemConfig);
  if (!isFptnConfigured(fptnConfig)) {
    return { ok: true };
  }

  const username = buildFptnUsernameForClient(client, fptnConfig.usernamePrefix);
  const upsertRes = await fptnUpsertUser(fptnConfig, { username });
  if (upsertRes.error && !isFptnNotFoundError(upsertRes.status, upsertRes.error)) {
    return { ok: false, error: upsertRes.error, status: upsertRes.status >= 400 ? upsertRes.status : 500 };
  }

  const extendRes = await fptnExtendSubscription(fptnConfig, { username, days: durationDays });
  if (extendRes.error) {
    return { ok: false, error: extendRes.error, status: extendRes.status >= 400 ? extendRes.status : 500 };
  }

  if (reason === "paid" && systemConfig.fptnRotateOnPaidActivation === true) {
    const rotateRes = await fptnRotateAccessKey(fptnConfig, { username });
    if (rotateRes.error) {
      return { ok: false, error: rotateRes.error, status: rotateRes.status >= 400 ? rotateRes.status : 500 };
    }
  }

  return { ok: true };
}

export async function reissueFptnSubscriptionForClient(client: FptnClientIdentity): Promise<
  | { ok: true; subscription: FptnNormalizedSubscription }
  | { ok: false; error: string; status: number }
> {
  const systemConfig = await getSystemConfig();
  const fptnConfig = resolveFptnConfig(systemConfig);
  if (!isFptnConfigured(fptnConfig)) {
    return { ok: false, error: "FPTN API not configured", status: 503 };
  }

  const username = buildFptnUsernameForClient(client, fptnConfig.usernamePrefix);
  const userRes = await fptnGetUserDetails(fptnConfig, username);
  if (userRes.error) {
    return {
      ok: false,
      error: isFptnNotFoundError(userRes.status, userRes.error) ? "Подписка FPTN не привязана" : userRes.error,
      status: userRes.status >= 400 ? userRes.status : 500,
    };
  }

  const rotateRes = await fptnRotateAccessKey(fptnConfig, { username });
  if (rotateRes.error) {
    return { ok: false, error: rotateRes.error, status: rotateRes.status >= 400 ? rotateRes.status : 500 };
  }

  const accessKeyRes = await fptnGetAccessKey(fptnConfig, username);
  if (accessKeyRes.error && !isFptnNotFoundError(accessKeyRes.status, accessKeyRes.error)) {
    return { ok: false, error: accessKeyRes.error, status: accessKeyRes.status >= 400 ? accessKeyRes.status : 500 };
  }

  const userData = unwrapFptnPayload(userRes.data ?? null) ?? userRes.data ?? null;
  const accessKeyData = unwrapFptnPayload(accessKeyRes.data ?? rotateRes.data ?? null) ?? accessKeyRes.data ?? rotateRes.data ?? null;

  return {
    ok: true,
    subscription: normalizeFptnSubscription({
      username,
      userData,
      accessKeyData,
    }),
  };
}
