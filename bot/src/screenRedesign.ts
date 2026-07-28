/**
 * STEALTHNET — Screen Redesign Test Harness
 *
 * Standalone bot for prototyping redesigned screens.
 * Sends rich-formatted screens via /redesign_* commands.
 * Uses emoji registry, formatting module, and message builders.
 *
 * Usage:
 *   TELEGRAM_API_URL=https://api.telegram.org \
 *   BOT_TOKEN=<token> \
 *   npx tsx bot/src/screenRedesign.ts
 */

import "dotenv/config";
import { Bot } from "grammy";
import { EMOJI, resolveEmoji, unicodeOf } from "./modules/emoji/registry.js";
import {
  formatMoney,
  currencySymbol,
  formatDate,
  formatDaysLeft,
  pluralizeDays,
  bytesToGb,
  progressBar,
  statusEmoji,
  statusLabel,
  truncate,
} from "./modules/formatting/index.js";
import {
  createMessage,
  pushLine,
  pushBold,
  pushCode,
  pushSeparator,
  pushEmojiLine,
} from "./modules/messages/builder.js";
import type { BotEntity } from "./modules/messages/builder.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════════

const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ═══════════════════════════════════════════════════════════════════════════════
// Screen Builders
// ═══════════════════════════════════════════════════════════════════════════════

function buildMainScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("STATUS_ACTIVE")} Кабинет ST-VPN`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_PACKAGE")} Подписка: ${unicodeOf("STATUS_ACTIVE")} Активна`);
  pushLine(msg, `  📅 до 15.08.2026`);
  pushLine(msg, `  📊 45.2 GB / 100 GB`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("PAY_CARD")} Баланс: 1,250.00 ₽`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_INFO")} Выберите действие:`);
  return msg;
}

function buildTariffScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("CONTENT_PACKAGE")} Тарифы`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("STATUS_ACTIVE")} Старт — 99₽/мес`);
  pushLine(msg, `  📊 30 GB · 📱 1 устройство`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("STATUS_ACTIVE")} Оптимум — 299₽/мес`);
  pushLine(msg, `  📊 100 GB · 📱 3 устройства`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("STATUS_ACTIVE")} Премиум — 599₽/мес`);
  pushLine(msg, `  📊 ∞ GB · 📱 5 устройств`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_INFO")} Выберите тариф для покупки:`);
  return msg;
}

function buildPaymentScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("PAY_CARD")} Оплата тарифа`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_PACKAGE")} Оптимум — 299₽/мес`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("STATUS_OK")} Способ оплаты:`);
  pushLine(msg, "");
  pushLine(msg, `  ${unicodeOf("PAY_CARD")} Банковская карта`);
  pushLine(msg, `  ${unicodeOf("PAY_BALANCE")} Баланс: 1,250₽`);
  pushLine(msg, `  ${unicodeOf("PAY_CRYPTO")} Криптовалюта`);
  pushLine(msg, `  ${unicodeOf("PAY_PROMO")} Промокод`);
  pushLine(msg, `  ${unicodeOf("PAY_STAR")} Telegram Stars`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_INFO")} Нажмите для оплаты:`);
  return msg;
}

function buildProfileScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("CONTENT_USER")} Профиль`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("PAY_CARD")} Баланс: 1,250.00 ₽`);
  pushLine(msg, `${unicodeOf("NAV_MENU")} Язык: ru`);
  pushLine(msg, `${unicodeOf("PAY_CARD")} Валюта: RUB`);
  pushLine(msg, `${unicodeOf("STATUS_OK")} Автопродление: Вкл`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_INFO")} Настройки:`);
  return msg;
}

function buildSubscriptionsScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("CONTENT_PACKAGE")} Мои подписки (2)`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("STATUS_ACTIVE")} #1 Оптимум`);
  pushLine(msg, `  📅 45 дн. до 15.08.2026`);
  pushLine(msg, `  📊 45.2 / 100 GB`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("STATUS_ACTIVE")} #2 Старт`);
  pushLine(msg, `  📅 12 дн. до 09.08.2026`);
  pushLine(msg, `  📊 8.1 / 30 GB`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_INFO")} Выберите подписку:`);
  return msg;
}

function buildPromoScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("PAY_PROMO")} Промокод`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_INFO")} Введите промокод для получения скидки или бонуса.`);
  pushLine(msg, "");
  pushLine(msg, `Как это работает:`);
  pushLine(msg, `  1. Получите промокод от нас или партнёра`);
  pushLine(msg, `  2. Введите код в поле ввода`);
  pushLine(msg, `  3. Бонус будет зачислен автоматически`);
  return msg;
}

function buildExtraScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("ACTION_ADD")} Дополнительные опции`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("STATUS_OK")} Доп. устройства — 99₽/мес`);
  pushLine(msg, `  📱 +2 устройства к текущему тарифу`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("STATUS_OK")} Расширенный трафик — 199₽/мес`);
  pushLine(msg, `  📊 +50 GB к лимиту`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_INFO")} Выберите дополнение:`);
  return msg;
}

function buildSupportScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("SOCIAL_HELP")} Помощь`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("SOCIAL_SUPPORT")} Наша команда поддержки готова помочь вам.`);
  pushLine(msg, "");
  pushLine(msg, `Часы работы: 10:00 — 22:00 (МСК)`);
  pushLine(msg, "");
  pushLine(msg, `Контакты:`);
  pushLine(msg, `  👤 Telegram ID: 12345678`);
  pushLine(msg, `  📋 Активных подписок: 2`);
  return msg;
}

function buildDevicesScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("CONTENT_DEVICE")} Устройства (3)`);
  pushLine(msg, "");
  pushLine(msg, `1. 📱 iPhone 15 · iOS 18`);
  pushLine(msg, `2. 💻 MacBook Pro · macOS 15`);
  pushLine(msg, `3. 📱 Samsung S24 · Android 15`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_INFO")} Нажмите «Удалить» для отвязки устройства.`);
  return msg;
}

function buildReferralScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("SOCIAL_REFER")} Реферальная программа`);
  pushLine(msg, "");
  pushLine(msg, `Поделитесь ссылкой с друзьями и получайте`);
  pushLine(msg, `процент со всех их пополнений! 🤝`);
  pushLine(msg, "");
  pushLine(msg, `👥 Рефералы 1 уровня: 15%`);
  pushLine(msg, `  • Переходов: 12`);
  pushLine(msg, `  • Приобрели: 5`);
  pushLine(msg, `  • Доход: 2,450₽`);
  pushLine(msg, "");
  pushLine(msg, `🤝 Рефералы 2 уровня: 5%`);
  pushLine(msg, `  • Приглашено: 3`);
  pushLine(msg, `  • Доход: 320₽`);
  return msg;
}

function buildSuccessScreen(): { text: string; entities: BotEntity[] } {
  const msg = createMessage();
  pushLine(msg, `${unicodeOf("STATUS_OK")} Оплата прошла успешно!`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_PACKAGE")} Тариф: Оптимум`);
  pushLine(msg, `${unicodeOf("PAY_CARD")} Сумма: 299₽`);
  pushLine(msg, `${unicodeOf("STATUS_ACTIVE")} Статус: Активирован`);
  pushLine(msg, "");
  pushLine(msg, `${unicodeOf("CONTENT_INFO")} Подписка зачислена на ваш аккаунт.`);
  pushLine(msg, `Подключение доступно в течение 5 минут.`);
  return msg;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bot Commands
// ═══════════════════════════════════════════════════════════════════════════════

bot.command("start", async (ctx) => {
  await ctx.reply(
    "STEALTHNET Screen Redesign Test Bot\n\n" +
    "Commands:\n" +
    "/redesign_main — Главное меню\n" +
    "/redesign_tariffs — Тарифы\n" +
    "/redesign_payment — Оплата\n" +
    "/redesign_profile — Профиль\n" +
    "/redesign_subs — Подписки\n" +
    "/redesign_promo — Промокод\n" +
    "/redesign_extra — Доп. опции\n" +
    "/redesign_support — Помощь\n" +
    "/redesign_devices — Устройства\n" +
    "/redesign_referral — Реферальная\n" +
    "/redesign_success — Успешная оплата"
  );
});

const screens: Record<string, () => { text: string; entities: BotEntity[] }> = {
  redesign_main: buildMainScreen,
  redesign_tariffs: buildTariffScreen,
  redesign_payment: buildPaymentScreen,
  redesign_profile: buildProfileScreen,
  redesign_subs: buildSubscriptionsScreen,
  redesign_promo: buildPromoScreen,
  redesign_extra: buildExtraScreen,
  redesign_support: buildSupportScreen,
  redesign_devices: buildDevicesScreen,
  redesign_referral: buildReferralScreen,
  redesign_success: buildSuccessScreen,
};

for (const [cmd, builder] of Object.entries(screens)) {
  bot.command(cmd, async (ctx) => {
    const { text, entities } = builder();
    await ctx.reply(text, {
      entities: entities.length ? entities : undefined,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════════════════════════════════════

console.log("Screen redesign bot starting...");
bot.start({ onStart: (info) => console.log(`@${info.username} started`) });
