/**
 * Вебхуки от Remna (RemnaWave) — события user.*, node.*, crm.* и т.д.
 * Спецификация в api-1.yaml: RemnawaveWebhookUserEventsDto, RemnawaveWebhookNodeEventsDto, ...
 */

import { createHash } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";

const webhookBodySchema = z.object({
  scope: z.string(),
  event: z.string(),
  timestamp: z.string(),
  data: z.record(z.unknown()).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const remnaWebhooksRouter = Router();

function hashHwidShort(rawHwid: string): string {
  return createHash("sha256").update(rawHwid).digest("hex").slice(0, 16);
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function getNestedString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function sendTelegramHwidAddedAlert(params: {
  chatId: string;
  botToken: string;
  hwid: string;
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
}): Promise<void> {
  const {
    chatId,
    botToken,
    hwid,
    platform,
    osVersion,
    deviceModel,
  } = params;
  const hwidHash = hashHwidShort(hwid);
  const lines = [
    "⚠️ Обнаружено новое устройство в вашей подписке.",
    "",
    `Платформа: ${platform || "—"}`,
    `OS: ${osVersion || "—"}`,
    `Модель: ${deviceModel || "—"}`,
    "",
    "Если это не ваше устройство, нажмите кнопку ниже, чтобы отвязать его.",
  ];

  const payload = {
    chat_id: chatId,
    text: lines.join("\n"),
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚫 Это не моё устройство", callback_data: `hwid_revoke:${hwidHash}` }],
      ],
    },
  };

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${response.status}): ${body.slice(0, 300)}`);
  }
}

remnaWebhooksRouter.post("/remna", async (req, res) => {
  const parsed = webhookBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid webhook payload", errors: parsed.error.flatten() });
  }

  const { scope, event, timestamp, data } = parsed.data;

  // Логируем и позже можно сохранять в БД, слать уведомления и т.д.
  console.log("[Remna Webhook]", { scope, event, timestamp, dataKeys: data ? Object.keys(data) : [] });

  // Уведомление в боте: добавлено новое HWID-устройство.
  if (scope === "user_hwid_devices" && event === "user_hwid_devices.added") {
    const dataObj = asRecord(data);
    const userObj = asRecord(dataObj.user);
    const hwidObj = asRecord(dataObj.hwidUserDevice);
    const userUuid = getNestedString(userObj, "uuid") || getNestedString(hwidObj, "userUuid");
    const hwid = getNestedString(hwidObj, "hwid");
    const platform = getNestedString(hwidObj, "platform");
    const osVersion = getNestedString(hwidObj, "osVersion");
    const deviceModel = getNestedString(hwidObj, "deviceModel");

    if (userUuid && hwid) {
      try {
        const client = await prisma.client.findFirst({
          where: { remnawaveUuid: userUuid, telegramId: { not: null }, isBlocked: false },
          select: { telegramId: true },
        });
        if (client?.telegramId?.trim()) {
          const config = await getSystemConfig();
          const botToken = config.telegramBotToken?.trim() || "";
          if (botToken) {
            await sendTelegramHwidAddedAlert({
              chatId: client.telegramId.trim(),
              botToken,
              hwid,
              platform,
              osVersion,
              deviceModel,
            });
          }
        }
      } catch (error) {
        console.error("[Remna Webhook] Failed to send HWID added alert", {
          scope,
          event,
          userUuid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Подтверждаем приём (Remna может ожидать 2xx)
  return res.status(200).json({ received: true, scope, event });
});
