/**
 * Синхронизация клиентов панели с Remna (из Remna и в Remna).
 */

import { prisma } from "../../db.js";
import {
  isRemnaConfigured,
  remnaGetUsers,
  remnaUpdateUser,
  remnaCreateUser,
  remnaGetUserByTelegramId,
  remnaGetUserByEmail,
  remnaGetUserByUsername,
  extractRemnaUuid,
} from "../remna/remna.client.js";
import { getSystemConfig } from "../client/client.service.js";

const PAGE_SIZE = 100;

type RemnaUser = {
  uuid?: string;
  telegramId?: number | null;
  email?: string | null;
  username?: string;
};

function extractRemnaUsers(data: unknown): RemnaUser[] {
  if (Array.isArray(data)) return data as RemnaUser[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.response && typeof obj.response === "object") {
      const resp = (obj.response as Record<string, unknown>).users;
      if (Array.isArray(resp)) return resp as RemnaUser[];
    }
    if (Array.isArray(obj.items)) return obj.items as RemnaUser[];
    if (Array.isArray(obj.data)) return obj.data as RemnaUser[];
    if (Array.isArray(obj.users)) return obj.users as RemnaUser[];
  }
  return [];
}

/** Синхронизация из Remna: загружаем пользователей Remna и создаём/обновляем клиентов в нашей БД. */
export async function syncFromRemna(): Promise<{
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}> {
  const result = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

  if (!isRemnaConfigured()) {
    result.errors.push("Remna API не настроен (REMNA_API_URL, REMNA_ADMIN_TOKEN)");
    return { ok: false, ...result };
  }

  // Берём настройки панели (язык/валюта по умолчанию),
  // чтобы новые клиенты из Remna создавались с теми же значениями.
  const config = await getSystemConfig();
  const defaultLang = config.defaultLanguage ?? "ru";
  const defaultCurrency = (config.defaultCurrency ?? "usd").toLowerCase();

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const start = (page - 1) * PAGE_SIZE;
    const res = await remnaGetUsers({ start, size: PAGE_SIZE });
    if (res.error) {
      result.errors.push(`Remna: ${res.error}`);
      break;
    }

    const users = extractRemnaUsers(res.data);
    if (users.length === 0) hasMore = false;
    else {
      for (const u of users) {
        const uuid = u.uuid;
        if (!uuid) {
          result.skipped++;
          continue;
        }
        const telegramId = u.telegramId != null ? String(u.telegramId) : null;
        const email = u.email && String(u.email).trim() ? String(u.email).trim() : null;
        const username = u.username && String(u.username).trim() ? String(u.username).trim() : null;

        try {
          const existingByUuid = await prisma.client.findFirst({
            where: { remnawaveUuid: uuid },
          });
          const existingByTg = telegramId
            ? await prisma.client.findFirst({ where: { telegramId } })
            : null;
          const existingByEmail = email
            ? await prisma.client.findFirst({ where: { email } })
            : null;

          const existing = existingByUuid || existingByTg || existingByEmail;

          if (existing) {
            await prisma.client.update({
              where: { id: existing.id },
              data: {
                remnawaveUuid: uuid,
                ...(telegramId && { telegramId }),
                ...(email && { email }),
                ...(username && !existing.telegramUsername && { telegramUsername: username }),
              },
            });
            result.updated++;
          } else {
            const refCode = "REF-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
            await prisma.client.create({
              data: {
                remnawaveUuid: uuid,
                email: email ?? null,
                telegramId,
                telegramUsername: username ?? null,
                referralCode: refCode,
                preferredLang: defaultLang,
                preferredCurrency: defaultCurrency,
              },
            });
            result.created++;
          }
        } catch (e) {
          result.errors.push(`${uuid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (users.length < PAGE_SIZE) hasMore = false;
      else page++;
    }
  }

  return { ok: result.errors.length === 0, ...result };
}

/** Синхронизация в Remna: отправляем данные наших клиентов (telegramId, email) в Remna. */
export async function syncToRemna(): Promise<{
  ok: boolean;
  updated: number;
  errors: string[];
}> {
  const result = { updated: 0, errors: [] as string[] };

  if (!isRemnaConfigured()) {
    result.errors.push("Remna API не настроен");
    return { ok: false, ...result };
  }

  const clients = await prisma.client.findMany({
    where: { remnawaveUuid: { not: null } },
    select: { id: true, remnawaveUuid: true, telegramId: true, email: true },
  });

  for (const c of clients) {
    const uuid = c.remnawaveUuid;
    if (!uuid) continue;
    try {
      const body: Record<string, unknown> = { uuid };
      if (c.telegramId != null) body.telegramId = parseInt(c.telegramId, 10);
      if (c.email != null) body.email = c.email;
      const res = await remnaUpdateUser(body);
      if (res.error) result.errors.push(`${uuid}: ${res.error}`);
      else result.updated++;
    } catch (e) {
      result.errors.push(`${uuid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: result.errors.length === 0, ...result };
}

/** Создать в Remna пользователей для клиентов панели, у которых ещё нет remnawaveUuid. */
export async function createRemnaUsersForClientsWithoutUuid(): Promise<{
  ok: boolean;
  created: number;
  linked: number;
  errors: string[];
}> {
  const result = { created: 0, linked: 0, errors: [] as string[] };

  if (!isRemnaConfigured()) {
    result.errors.push("Remna API не настроен");
    return { ok: false, ...result };
  }

  const clients = await prisma.client.findMany({
    where: { remnawaveUuid: null },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });

  for (const c of clients) {
    try {
      let uuid: string | null = null;
      if (c.telegramId?.trim()) {
        const res = await remnaGetUserByTelegramId(c.telegramId.trim());
        uuid = extractRemnaUuid(res.data);
      }
      if (!uuid && c.email?.trim()) {
        const res = await remnaGetUserByEmail(c.email.trim());
        uuid = extractRemnaUuid(res.data);
      }
      if (!uuid) {
        const rawName = c.email?.split("@")[0] || `user${c.id.slice(-6)}`;
        const username = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36) || "u_" + Date.now().toString(36);
        const finalUsername = username.length >= 3 ? username : "u_" + username;
        const byUsernameRes = await remnaGetUserByUsername(finalUsername);
        uuid = extractRemnaUuid(byUsernameRes.data);
      }
      if (!uuid) {
        const rawName = c.email?.split("@")[0] || `user${c.id.slice(-6)}`;
        const username = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36) || "u_" + Date.now().toString(36);
        const finalUsername = username.length >= 3 ? username : "u_" + username;
        const createRes = await remnaCreateUser({
          username: finalUsername,
          trafficLimitBytes: 0,
          trafficLimitStrategy: "NO_RESET",
          expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          ...(c.telegramId && { telegramId: parseInt(c.telegramId, 10) }),
          ...(c.email && { email: c.email }),
        });
        uuid = extractRemnaUuid(createRes.data);
        if (uuid) result.created++;
      } else {
        result.linked++;
      }
      if (uuid) {
        await prisma.client.update({
          where: { id: c.id },
          data: { remnawaveUuid: uuid },
        });
      } else {
        result.errors.push(`Client ${c.id}: не удалось получить или создать UUID в Remna`);
      }
    } catch (e) {
      result.errors.push(`Client ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: result.errors.length === 0, ...result };
}
