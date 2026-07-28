/**
 * STEALTHNET — Rich Message Builder
 *
 * Advanced message formatting for Telegram.
 * Supports:
 * - Collapsible sections (using Telegram blockquotes)
 * - Formatted lists with emoji bullets
 * - Key-value displays with alignment
 * - Status cards with progress indicators
 * - Card-like layouts using entities
 * - Horizontal separators
 * - Inline code blocks for copyable text
 *
 * All formatting uses Telegram entity types, NOT parse_mode,
 * for maximum control and safety.
 */

import { EMOJI, resolveEmoji } from "../emoji/registry.js";
import { createMessage, pushLine, pushBold, pushCode, pushEmojiLine, pushSeparator, mergeMessages } from "./builder.js";
import type { MessageBuilder, BotEntity } from "./builder.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface ListItem {
  /** Text content (can include markdown) */
  text: string;
  /** Optional emoji key from registry */
  emojiKey?: string;
  /** Optional custom emoji unicode (overrides registry) */
  emoji?: string;
  /** Optional bold formatting */
  bold?: boolean;
  /** Optional code formatting */
  code?: boolean;
  /** Optional trailing detail text */
  detail?: string;
}

export interface KeyValueItem {
  key: string;
  value: string | number;
  /** Optional emoji key from registry */
  emojiKey?: string;
  /** Whether to bold the value */
  boldValue?: boolean;
  /** Whether to show as code */
  codeValue?: boolean;
}

export interface StatusConfig {
  /** Status type determines emoji */
  status: "active" | "expired" | "inactive" | "limited" | "disabled" | "pending" | "ok" | "error" | "warning";
  /** Main title */
  title: string;
  /** Subtitle or description */
  subtitle?: string;
  /** Key-value pairs to display */
  details?: KeyValueItem[];
  /** Optional progress (0-100) for progress bar */
  progress?: number;
  /** Optional expiry info */
  expiresAt?: Date | string | number;
  /** Optional days left */
  daysLeft?: number;
}

export interface CollapsibleSection {
  /** Section title (shown when collapsed) */
  title: string;
  /** Content lines */
  content: string[];
  /** Whether section is expanded by default */
  expanded?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rich Message Builders
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a formatted list with emoji bullets.
 * 
 * @example
 * const msg = createRichList([
 *   { text: "Basic Plan", emojiKey: "CONTENT_PACKAGE", detail: "500 ₽/мес" },
 *   { text: "Premium Plan", emojiKey: "CONTENT_PACKAGE", detail: "1000 ₽/мес", bold: true },
 * ]);
 */
export function createRichList(items: ListItem[]): MessageBuilder {
  const builder = createMessage();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prefix = builder.text.length > 0 ? "\n" : "";
    const offset = builder.text.length + prefix.length;

    // Emoji
    let emojiStr = item.emoji ?? "•";
    if (item.emojiKey) {
      emojiStr = resolveEmoji(item.emojiKey).unicode;
    }

    // Build line
    const space = item.text.startsWith("\n") ? "" : " ";
    let line = emojiStr + space + item.text;
    let lineLen = line.length;

    // Detail
    if (item.detail) {
      line += ` — ${item.detail}`;
    }

    builder.text += prefix + line;

    // Add emoji entity if it's a custom emoji
    if (item.emojiKey) {
      const resolved = resolveEmoji(item.emojiKey);
      if (resolved.premiumId) {
        const emojiLen = Array.from(emojiStr).reduce<number>((l, ch) => {
          const cp = ch.codePointAt(0);
          return l + (cp != null && cp > 0xffff ? 2 : 1);
        }, 0);
        builder.entities.push({
          type: "custom_emoji",
          offset,
          length: emojiLen,
          custom_emoji_id: resolved.premiumId,
        });
      }
    }

    // Bold entity for text
    if (item.bold) {
      // Find text offset after emoji + space
      const textOffset = offset + emojiStr.length + 1;
      builder.entities.push({
        type: "bold",
        offset: textOffset,
        length: item.text.length,
      });
    }

    // Code entity for text
    if (item.code) {
      const textOffset = offset + emojiStr.length + 1;
      builder.entities.push({
        type: "code",
        offset: textOffset,
        length: item.text.length,
      });
    }
  }

  return builder;
}

/**
 * Create a key-value display.
 * 
 * @example
 * const msg = createKeyValueDisplay([
 *   { key: "Баланс", value: "1 000 ₽", emojiKey: "PAY_BALANCE" },
 *   { key: "Тариф", value: "Premium", emojiKey: "CONTENT_PACKAGE", boldValue: true },
 * ]);
 */
export function createKeyValueDisplay(items: KeyValueItem[]): MessageBuilder {
  const builder = createMessage();

  for (const item of items) {
    const prefix = builder.text.length > 0 ? "\n" : "";
    const offset = builder.text.length + prefix.length;

    // Emoji
    let emojiStr = "";
    if (item.emojiKey) {
      emojiStr = resolveEmoji(item.emojiKey).unicode + " ";
    }

    // Key (bold)
    const keyText = `${emojiStr}${item.key}: `;
    builder.text += prefix + keyText;
    const keyOffset = offset;
    builder.entities.push({
      type: "bold",
      offset: keyOffset,
      length: keyText.length,
    });

    // Value
    const valueStr = String(item.value);
    const valueOffset = builder.text.length;
    builder.text += valueStr;

    if (item.boldValue) {
      builder.entities.push({
        type: "bold",
        offset: valueOffset,
        length: valueStr.length,
      });
    }

    if (item.codeValue) {
      builder.entities.push({
        type: "code",
        offset: valueOffset,
        length: valueStr.length,
      });
    }

    // Custom emoji entity
    if (item.emojiKey) {
      const resolved = resolveEmoji(item.emojiKey);
      if (resolved.premiumId) {
        const emojiLen = Array.from(resolved.unicode).reduce<number>((l, ch) => {
          const cp = ch.codePointAt(0);
          return l + (cp != null && cp > 0xffff ? 2 : 1);
        }, 0);
        builder.entities.push({
          type: "custom_emoji",
          offset,
          length: emojiLen,
          custom_emoji_id: resolved.premiumId,
        });
      }
    }
  }

  return builder;
}

/**
 * Create a status card with emoji, title, and details.
 * 
 * @example
 * const msg = createStatusCard({
 *   status: "active",
 *   title: "Премиум подписка",
 *   subtitle: "До окончания: 15 дней",
 *   details: [
 *     { key: "Трафик", value: "50 GB" },
 *     { key: "Устройства", value: "3" },
 *   ],
 *   expiresAt: new Date("2024-02-01"),
 *   daysLeft: 15,
 * });
 */
export function createStatusCard(config: StatusConfig): MessageBuilder {
  const builder = createMessage();

  const statusEmojiMap: Record<string, string> = {
    active: "🟢",
    expired: "🔴",
    inactive: "🔴",
    limited: "🟡",
    disabled: "🔴",
    pending: "⏳",
    ok: "✅",
    error: "❌",
    warning: "⚠️",
  };

  const emojiStr = statusEmojiMap[config.status] ?? "⚪";

  // Title line with emoji
  pushEmojiLine(builder, emojiStr, config.title);

  // Subtitle
  if (config.subtitle) {
    pushLine(builder, config.subtitle);
  }

  // Separator
  if (config.details && config.details.length > 0) {
    pushSeparator(builder);
  }

  // Details
  if (config.details && config.details.length > 0) {
    const detailBuilder = createKeyValueDisplay(config.details);
    const merged = mergeMessages(builder, detailBuilder);
    builder.text = merged.text;
    builder.entities = merged.entities;
  }

  // Expiry info
  if (config.expiresAt || config.daysLeft != null) {
    pushSeparator(builder);

    let expiryText = "";
    if (config.daysLeft != null) {
      expiryText = `⏰ Осталось: ${config.daysLeft} дн.`;
    } else if (config.expiresAt) {
      const date = typeof config.expiresAt === "string"
        ? new Date(config.expiresAt)
        : typeof config.expiresAt === "number"
        ? new Date(config.expiresAt * 1000)
        : config.expiresAt;
      expiryText = `⏰ До: ${date.toLocaleDateString("ru-RU")}`;
    }

    pushLine(builder, expiryText);
  }

  return builder;
}

/**
 * Create a collapsible section using Telegram blockquote.
 * Note: Telegram doesn't have native collapsible sections,
 * so we simulate with blockquote formatting.
 * 
 * @example
 * const msg = createCollapsibleSection({
 *   title: "Подробности тарифа",
 *   content: [
 *     "Трафик: 50 GB",
 *     "Устройства: 3",
 *     "Серверы: 10+ стран",
 *   ],
 * });
 */
export function createCollapsibleSection(section: CollapsibleSection): MessageBuilder {
  const builder = createMessage();

  // Title (bold)
  pushBold(builder, `▎ ${section.title}`);

  // Content as blockquote lines
  for (const line of section.content) {
    pushLine(builder, `  ▸ ${line}`);
  }

  return builder;
}

/**
 * Create a formatted table-like display.
 * Useful for showing tariff plans or pricing.
 * 
 * @example
 * const msg = createTable(
 *   ["План", "Трафик", "Цена"],
 *   [
 *     ["Basic", "10 GB", "300 ₽"],
 *     ["Premium", "50 GB", "800 ₽"],
 *     ["Ultimate", "∞", "1500 ₽"],
 *   ],
 * );
 */
export function createTable(headers: string[], rows: string[][]): MessageBuilder {
  const builder = createMessage();

  // Header (bold)
  const headerLine = headers.join(" | ");
  pushBold(builder, headerLine);

  // Separator
  pushSeparator(builder);

  // Rows
  for (const row of rows) {
    const line = row.join(" | ");
    pushLine(builder, line);
  }

  return builder;
}

/**
 * Create a progress bar visualization.
 * 
 * @example
 * const msg = createProgressBar(75, 100, "50 GB");
 */
export function createProgressBar(
  current: number,
  total: number,
  label?: string,
  length = 10,
): MessageBuilder {
  const builder = createMessage();

  const percent = Math.min(100, Math.max(0, (current / total) * 100));
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;

  const bar = "█".repeat(filled) + "░".repeat(empty);
  const percentStr = `${Math.round(percent)}%`;

  let line = `${bar} ${percentStr}`;
  if (label) {
    line = `${label}: ${line}`;
  }

  pushLine(builder, line);

  // Color indicator based on usage
  let statusEmoji = "🟢";
  if (percent >= 90) statusEmoji = "🔴";
  else if (percent >= 70) statusEmoji = "🟡";

  pushLine(builder, `${statusEmoji} ${current} / ${total}`);

  return builder;
}

/**
 * Create a multi-section message with separators.
 * 
 * @example
 * const msg = createMultiSection([
 *   { title: "Основная информация", content: ["Тариф: Premium", "Статус: Активен"] },
 *   { title: "Статистика", content: ["Загрузка: 25 GB", "Устройства: 2/3"] },
 * ]);
 */
export function createMultiSection(sections: { title: string; content: string[] }[]): MessageBuilder {
  const builder = createMessage();

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    if (i > 0) {
      pushSeparator(builder);
    }

    pushBold(builder, section.title);

    for (const line of section.content) {
      pushLine(builder, line);
    }
  }

  return builder;
}

/**
 * Create a quick-action card with emoji + text + detail.
 * Useful for showing subscription options or menu items.
 * 
 * @example
 * const msg = createQuickActions([
 *   { emojiKey: "CONTENT_PACKAGE", text: "Тарифы", detail: "Выбрать план" },
 *   { emojiKey: "PAY_BALANCE", text: "Пополнить", detail: "Баланс: 500 ₽" },
 * ]);
 */
export function createQuickActions(
  actions: { emojiKey?: string; emoji?: string; text: string; detail?: string }[],
): MessageBuilder {
  const builder = createMessage();

  for (const action of actions) {
    const prefix = builder.text.length > 0 ? "\n" : "";
    const offset = builder.text.length + prefix.length;

    // Emoji
    let emojiStr = action.emoji ?? "•";
    if (action.emojiKey) {
      emojiStr = resolveEmoji(action.emojiKey).unicode;
    }

    // Text
    let line = `${emojiStr} ${action.text}`;
    if (action.detail) {
      line += ` — ${action.detail}`;
    }

    builder.text += prefix + line;

    // Bold the text part
    const textOffset = offset + emojiStr.length + 1;
    builder.entities.push({
      type: "bold",
      offset: textOffset,
      length: action.text.length,
    });

    // Custom emoji entity
    if (action.emojiKey) {
      const resolved = resolveEmoji(action.emojiKey);
      if (resolved.premiumId) {
        const emojiLen = Array.from(emojiStr).reduce<number>((l, ch) => {
          const cp = ch.codePointAt(0);
          return l + (cp != null && cp > 0xffff ? 2 : 1);
        }, 0);
        builder.entities.push({
          type: "custom_emoji",
          offset,
          length: emojiLen,
          custom_emoji_id: resolved.premiumId,
        });
      }
    }
  }

  return builder;
}

/**
 * Create a help/info message with a tip at the bottom.
 * 
 * @example
 * const msg = createInfoMessage(
 *   "Как пользоваться ботом",
 *   ["Выберите тариф", "Оплатите", "Получите ссылку"],
 *   "Для помощи напишите /support",
 * );
 */
export function createInfoMessage(
  title: string,
  content: string[],
  tip?: string,
): MessageBuilder {
  const builder = createMessage();

  // Title
  pushBold(builder, title);

  // Content
  for (const line of content) {
    pushLine(builder, line);
  }

  // Tip
  if (tip) {
    pushSeparator(builder);
    const tipEmoji = resolveEmoji("CONTENT_INFO").unicode;
    pushLine(builder, `${tipEmoji} ${tip}`);
  }

  return builder;
}
