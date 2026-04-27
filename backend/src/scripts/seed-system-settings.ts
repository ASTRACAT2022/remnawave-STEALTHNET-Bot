import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";

const DEFAULTS: Array<[string, string]> = [
  ["active_languages", "ru,en"],
  ["active_currencies", "usd,rub"],
  ["default_referral_percent", "10"],
  ["trial_days", "3"],
  ["service_name", "STEALTHNET"],
  [
    "bot_inner_button_styles",
    '{"tariffPay":"success","topup":"primary","back":"danger","profile":"primary","trialConfirm":"success","lang":"primary","currency":"primary"}',
  ],
  ["category_emojis", '{"ordinary":"📦","premium":"⭐"}'],
  [
    "bot_emojis",
    '{"TRIAL":{"unicode":"🎁"},"PACKAGE":{"unicode":"📦"},"CARD":{"unicode":"💳"},"LINK":{"unicode":"🔗"},"SERVERS":{"unicode":"🌐"},"PUZZLE":{"unicode":"🧩"},"BACK":{"unicode":"◀️"},"MAIN_MENU":{"unicode":"👋"},"BALANCE":{"unicode":"💰"},"TARIFFS":{"unicode":"📦"},"HEADER":{"unicode":"🛡"}}',
  ],
  [
    "bot_menu_line_visibility",
    '{"welcomeTitlePrefix":true,"welcomeGreeting":true,"balancePrefix":true,"tariffPrefix":true,"subscriptionPrefix":true,"expirePrefix":true,"daysLeftPrefix":true,"devicesLabel":true,"trafficPrefix":true,"linkLabel":true,"chooseAction":true}',
  ],
  ["default_auto_renew_enabled", "false"],
  ["auto_renew_days_before_expiry", "1"],
  ["auto_renew_notify_days_before", "3"],
  ["auto_renew_grace_period_days", "2"],
  ["auto_renew_max_retries", "3"],
  ["yookassa_recurring_enabled", "false"],
  ["gift_subscriptions_enabled", "false"],
  ["gift_code_expiry_hours", "72"],
  ["max_additional_subscriptions", "5"],
  ["gift_code_format_length", "12"],
  ["gift_rate_limit_per_minute", "5"],
  ["gift_expiry_notification_days", "3"],
  ["gift_referral_enabled", "true"],
  ["gift_message_max_length", "200"],
  ["telegram_api_provider", "official"],
];

export async function ensureSystemSettings() {
  for (const [key, value] of DEFAULTS) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }
  await seedEnglishPack();
}

async function seedEnglishPack() {
  const existing = await prisma.systemSetting.findUnique({ where: { key: "lang_pack_en" } });
  if (existing) return;
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(dir, "../i18n/en.json"),
      resolve(dir, "../../../frontend/src/i18n/locales/en.json"),
    ];
    let data: string | null = null;
    for (const p of candidates) {
      try { data = readFileSync(p, "utf-8"); break; } catch { /* next */ }
    }
    if (!data) { console.warn("[seed] en.json not found, skip"); return; }
    JSON.parse(data);
    await prisma.systemSetting.create({ data: { key: "lang_pack_en", value: data } });
    console.log("[seed] English language pack seeded");
  } catch (e) {
    console.warn("[seed] Could not seed English pack:", e instanceof Error ? e.message : e);
  }
}
