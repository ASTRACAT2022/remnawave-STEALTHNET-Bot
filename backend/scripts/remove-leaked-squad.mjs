#!/usr/bin/env node

/**
 * Массово убирает "утёкший" internal squad у клиентов без entitlement в БД.
 *
 * По умолчанию dry-run (без изменений).
 *
 * Env:
 *   LEAKED_SQUAD_UUID (или PREMIUM_SQUAD_UUID) - обязательно
 *   REMNA_API_URL                              - обязательно
 *   REMNA_ADMIN_TOKEN                          - обязательно
 *   MAX_USERS                                  - опционально (0 = без лимита)
 *   SLEEP_MS                                   - опционально (по умолчанию 20)
 *
 * Запуск в контейнере api:
 *   docker exec -e LEAKED_SQUAD_UUID=<UUID> stealthnet-api node /app/scripts/remove-leaked-squad.mjs
 *   docker exec -e LEAKED_SQUAD_UUID=<UUID> stealthnet-api node /app/scripts/remove-leaked-squad.mjs --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const LEAKED_SQUAD_UUID = (process.env.LEAKED_SQUAD_UUID || process.env.PREMIUM_SQUAD_UUID || "").trim();
const REMNA_API_URL = (process.env.REMNA_API_URL || "").trim().replace(/\/$/, "");
const REMNA_ADMIN_TOKEN = (process.env.REMNA_ADMIN_TOKEN || "").trim();
const MAX_USERS = Number(process.env.MAX_USERS || 0);
const SLEEP_MS = Number(process.env.SLEEP_MS || 20);

function die(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSquads(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object" && typeof item.uuid === "string" && item.uuid.trim()) {
      out.push(item.uuid.trim());
    }
  }
  return [...new Set(out)];
}

function extractActiveInternalSquads(payload) {
  if (!payload || typeof payload !== "object") return [];
  const root = payload;
  const base = root.response || root.data || root;
  if (!base || typeof base !== "object") return [];
  return normalizeSquads(base.activeInternalSquads);
}

async function remnaFetch(path, init = {}) {
  const res = await fetch(`${REMNA_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${REMNA_ADMIN_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && (data.message || data.error || data.detail)) ||
      `${res.status} ${res.statusText}`;
    return { ok: false, status: res.status, error: String(msg), data };
  }
  return { ok: true, status: res.status, data };
}

async function loadAllowedClientIds(leakedSquadUuid) {
  const allowed = new Set();

  const leakedTariffs = await prisma.tariff.findMany({
    where: { internalSquadUuids: { has: leakedSquadUuid } },
    select: { id: true },
  });
  const leakedTariffIds = leakedTariffs.map((t) => t.id);

  if (leakedTariffIds.length > 0) {
    const paidClients = await prisma.payment.findMany({
      where: { status: "PAID", tariffId: { in: leakedTariffIds } },
      select: { clientId: true },
      distinct: ["clientId"],
    });
    for (const row of paidClients) allowed.add(row.clientId);
  }

  const promoGroupClients = await prisma.promoActivation.findMany({
    where: { promoGroup: { squadUuid: leakedSquadUuid } },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  for (const row of promoGroupClients) allowed.add(row.clientId);

  const promoCodeClients = await prisma.promoCodeUsage.findMany({
    where: { promoCode: { type: "FREE_DAYS", squadUuid: leakedSquadUuid } },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  for (const row of promoCodeClients) allowed.add(row.clientId);

  const trialSquad = await prisma.systemSetting.findUnique({
    where: { key: "trial_squad_uuid" },
    select: { value: true },
  });
  if ((trialSquad?.value || "").trim() === leakedSquadUuid) {
    const trialClients = await prisma.client.findMany({
      where: { trialUsed: true },
      select: { id: true },
    });
    for (const row of trialClients) allowed.add(row.id);
  }

  return {
    allowed,
    leakedTariffIdsCount: leakedTariffIds.length,
  };
}

async function main() {
  if (!LEAKED_SQUAD_UUID) die("LEAKED_SQUAD_UUID (или PREMIUM_SQUAD_UUID) не задан");
  if (!REMNA_API_URL) die("REMNA_API_URL не задан");
  if (!REMNA_ADMIN_TOKEN) die("REMNA_ADMIN_TOKEN не задан");

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Leaked squad: ${LEAKED_SQUAD_UUID}`);

  const allowedInfo = await loadAllowedClientIds(LEAKED_SQUAD_UUID);
  const allowed = allowedInfo.allowed;

  let clients = await prisma.client.findMany({
    where: { remnawaveUuid: { not: null } },
    select: { id: true, remnawaveUuid: true },
    orderBy: { createdAt: "asc" },
  });
  if (MAX_USERS > 0) clients = clients.slice(0, MAX_USERS);

  console.log(`Clients with remna UUID: ${clients.length}`);
  console.log(`Allowed by DB entitlement: ${allowed.size}`);
  console.log(`Tariffs containing leaked squad: ${allowedInfo.leakedTariffIdsCount}`);

  let checked = 0;
  let hasLeakedSquad = 0;
  let skippedAllowed = 0;
  let fixed = 0;
  let dryCandidates = 0;
  const errors = [];

  for (const c of clients) {
    checked += 1;
    if (allowed.has(c.id)) {
      skippedAllowed += 1;
      continue;
    }

    const remnaUuid = (c.remnawaveUuid || "").trim();
    if (!remnaUuid) continue;

    const getRes = await remnaFetch(`/api/users/${encodeURIComponent(remnaUuid)}`);
    if (!getRes.ok) {
      errors.push(`GET ${c.id}/${remnaUuid}: ${getRes.error}`);
      continue;
    }

    const currentSquads = extractActiveInternalSquads(getRes.data);
    if (!currentSquads.includes(LEAKED_SQUAD_UUID)) continue;
    hasLeakedSquad += 1;

    const nextSquads = currentSquads.filter((s) => s !== LEAKED_SQUAD_UUID);
    if (!APPLY) {
      dryCandidates += 1;
      continue;
    }

    const patchRes = await remnaFetch("/api/users", {
      method: "PATCH",
      body: JSON.stringify({
        uuid: remnaUuid,
        activeInternalSquads: nextSquads,
      }),
    });
    if (!patchRes.ok) {
      errors.push(`PATCH ${c.id}/${remnaUuid}: ${patchRes.error}`);
    } else {
      fixed += 1;
    }

    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  }

  console.log("\nSummary:");
  console.log(`- checked: ${checked}`);
  console.log(`- skipped_allowed: ${skippedAllowed}`);
  console.log(`- with_leaked_squad: ${hasLeakedSquad}`);
  console.log(`- ${APPLY ? "fixed" : "dry_candidates"}: ${APPLY ? fixed : dryCandidates}`);
  console.log(`- errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log("\nError samples:");
    for (const e of errors.slice(0, 20)) console.log(`  - ${e}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
