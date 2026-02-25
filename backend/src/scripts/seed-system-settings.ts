import { prisma } from "../db.js";

const DEFAULTS: Array<[string, string]> = [
  ["active_languages", "ru,ua,en"],
  ["active_currencies", "uah,usd,rub"],
  ["default_referral_percent", "10"],
  ["trial_days", "3"],
  ["service_name", "STEALTHNET"],
  ["yookassa_vat_code", "1"],
  ["yookassa_sbp_enabled", "false"],
  ["yookassa_payment_mode", "full_payment"],
  ["yookassa_payment_subject", "service"],
  ["telegram_stars_enabled", "true"],
  ["telegram_stars_rate", "1"],
  ["bot_admin_ids", ""],
  ["nalogo_enabled", "false"],
  ["nalogo_timeout", "30"],
  ["nalogo_python_bridge_enabled", "true"],
  ["nalogo_python_bridge_only", "true"],
  [
    "bot_inner_button_styles",
    '{"tariffPay":"success","topup":"primary","back":"danger","profile":"primary","trialConfirm":"success","lang":"primary","currency":"primary"}',
  ],
  ["category_emojis", '{"ordinary":"📦","premium":"⭐"}'],
  [
    "bot_emojis",
    '{"TRIAL":{"unicode":"🎁"},"PACKAGE":{"unicode":"📦"},"CARD":{"unicode":"💳"},"LINK":{"unicode":"🔗"},"SERVERS":{"unicode":"🌐"},"PUZZLE":{"unicode":"🧩"},"BACK":{"unicode":"◀️"},"MAIN_MENU":{"unicode":"👋"},"BALANCE":{"unicode":"💰"},"TARIFFS":{"unicode":"📦"},"HEADER":{"unicode":"🛡"}}',
  ],
];

export async function ensureSystemSettings() {
  for (const [key, value] of DEFAULTS) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }
}
