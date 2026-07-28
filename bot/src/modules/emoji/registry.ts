/**
 * STEALTHNET — Centralized Emoji Registry
 *
 * Semantic emoji keys mapped to Unicode fallbacks and Premium Emoji IDs.
 * All emoji usage in the bot MUST go through this registry.
 *
 * Premium Emoji ID format: Telegram Custom Emoji IDs (numeric strings).
 * If a Premium Emoji is unavailable, the Unicode fallback is used automatically.
 */

export interface EmojiEntry {
  /** Unicode fallback for non-Premium clients */
  unicode: string;
  /** Telegram Premium Custom Emoji ID (set via admin panel or hardcoded) */
  premiumId?: string;
  /** Semantic label for documentation */
  label: string;
  /** Category for grouping */
  category: "status" | "action" | "nav" | "content" | "payment" | "social" | "system";
}

/**
 * Default emoji registry. Premium IDs are overridden at runtime
 * from botEmojis config (admin panel).
 */
export const EMOJI: Record<string, EmojiEntry> = {
  // ─── Status ───
  STATUS_ACTIVE:     { unicode: "🟢", label: "Active subscription", category: "status" },
  STATUS_EXPIRED:    { unicode: "🔴", label: "Expired subscription", category: "status" },
  STATUS_INACTIVE:   { unicode: "🔴", label: "Inactive subscription", category: "status" },
  STATUS_LIMITED:    { unicode: "🟡", label: "Limited subscription", category: "status" },
  STATUS_DISABLED:   { unicode: "🔴", label: "Disabled subscription", category: "status" },
  STATUS_OK:         { unicode: "✅", label: "Success/OK", category: "status" },
  STATUS_ERROR:      { unicode: "❌", label: "Error/Failed", category: "status" },
  STATUS_WARNING:    { unicode: "⚠️", label: "Warning", category: "status" },
  STATUS_PENDING:    { unicode: "⏳", label: "Pending", category: "status" },

  // ─── Navigation ───
  NAV_BACK:          { unicode: "◀️", label: "Back", category: "nav" },
  NAV_HOME:          { unicode: "🏠", label: "Home/Main Menu", category: "nav" },
  NAV_FORWARD:       { unicode: "▶️", label: "Forward", category: "nav" },
  NAV_MENU:          { unicode: "📋", label: "Menu list", category: "nav" },
  NAV_CLOSE:         { unicode: "✖️", label: "Close/Cancel", category: "nav" },
  NAV_REFRESH:       { unicode: "🔄", label: "Refresh/Update", category: "nav" },

  // ─── Actions ───
  ACTION_BUY:        { unicode: "🛒", label: "Buy/Purchase", category: "action" },
  ACTION_PAY:        { unicode: "💳", label: "Pay", category: "action" },
  ACTION_GIFT:       { unicode: "🎁", label: "Gift/Trial", category: "action" },
  ACTION_CONNECT:    { unicode: "📲", label: "Connect/Install", category: "action" },
  ACTION_RENEW:      { unicode: "💰", label: "Renew/Extend", category: "action" },
  ACTION_DELETE:     { unicode: "🗑", label: "Delete/Remove", category: "action" },
  ACTION_ADD:        { unicode: "➕", label: "Add/Extra", category: "action" },
  ACTION_SEARCH:     { unicode: "🔍", label: "Search", category: "action" },
  ACTION_CONFIGURE:  { unicode: "⚙️", label: "Configure/Settings", category: "action" },
  ACTIVATE:          { unicode: "✅", label: "Activate", category: "action" },

  // ─── Content ───
  CONTENT_PACKAGE:   { unicode: "📦", label: "Package/Plan/Tariff", category: "content" },
  CONTENT_LOCATION:  { unicode: "🌐", label: "Location/Server", category: "content" },
  CONTENT_DEVICE:    { unicode: "📱", label: "Device", category: "content" },
  CONTENT_LINK:      { unicode: "🔗", label: "Link", category: "content" },
  CONTENT_KEY:       { unicode: "🔑", label: "Key/Access", category: "content" },
  CONTENT_SHIELD:    { unicode: "🛡", label: "Shield/Protection", category: "content" },
  CONTENT_CHART:     { unicode: "📊", label: "Statistics/Chart", category: "content" },
  CONTENT_USER:      { unicode: "👤", label: "User/Profile", category: "content" },
  CONTENT_INFO:      { unicode: "💡", label: "Info/Tip", category: "content" },
  CONTENT_VIDEO:     { unicode: "📹", label: "Video", category: "content" },
  CONTENT_DOCUMENT:  { unicode: "📄", label: "Document", category: "content" },

  // ─── Payment ───
  PAY_CARD:          { unicode: "💳", label: "Card payment", category: "payment" },
  PAY_BALANCE:       { unicode: "💰", label: "Balance payment", category: "payment" },
  PAY_CRYPTO:        { unicode: "🪙", label: "Crypto payment", category: "payment" },
  PAY_PROMO:         { unicode: "🎟️", label: "Promo code", category: "payment" },
  PAY_STAR:          { unicode: "⭐", label: "Star/Best price", category: "payment" },
  PAY_RECEIPT:       { unicode: "🧾", label: "Receipt", category: "payment" },

  // ─── Social ───
  SOCIAL_REFER:      { unicode: "👥", label: "Referral/Invite", category: "social" },
  SOCIAL_SUPPORT:    { unicode: "🧑‍💼", label: "Support agent", category: "social" },
  SOCIAL_HELP:       { unicode: "❓", label: "Help/Support", category: "social" },

  // ─── System ───
  SYSTEM_TICKET:     { unicode: "🎫", label: "Ticket", category: "system" },
  SYSTEM_BELL:       { unicode: "🔔", label: "Notifications", category: "system" },
  SYSTEM_ADMIN:      { unicode: "⚙️", label: "Admin panel", category: "system" },
  SYSTEM_DISCOUNT:   { unicode: "🏷️", label: "Discount/Sale", category: "system" },
  SYSTEM_GIFT_BOX:   { unicode: "🎁", label: "Gift box", category: "system" },
  SYSTEM_BALLOON:    { unicode: "🎈", label: "Celebration", category: "system" },
};

/** Short alias keys used in legacy DEFAULT_MENU_EMOJI_KEY_BY_ID mapping */
export const LEGACY_KEY_MAP: Record<string, string> = {
  PACKAGE: "CONTENT_PACKAGE",
  TARIFFS: "CONTENT_PACKAGE",
  CARD: "PAY_CARD",
  LINK: "CONTENT_LINK",
  PUZZLE: "CONTENT_USER",
  PROFILE: "CONTENT_USER",
  TRIAL: "ACTION_GIFT",
  SERVERS: "CONTENT_LOCATION",
  CONNECT: "ACTION_CONNECT",
  CHART: "CONTENT_CHART",
  STAR: "PAY_STAR",
  NOTE: "SYSTEM_TICKET",
  DEVICES: "CONTENT_DEVICE",
  BACK: "NAV_BACK",
  BACK_TO_SUB: "NAV_BACK",
  BACK_TO_SUBS_LIST: "NAV_BACK",
};

/**
 * Resolve an emoji for a given key.
 * @param key — emoji key (e.g., "STATUS_ACTIVE", "CARD")
 * @param premiumOverrides — runtime premium emoji IDs from admin config (botEmojis)
 * @returns { unicode, premiumId? }
 */
export function resolveEmoji(
  key: string,
  premiumOverrides?: Record<string, { unicode?: string; tgEmojiId?: string }> | null,
): { unicode: string; premiumId?: string } {
  // Check premium overrides first (admin panel config)
  const override = premiumOverrides?.[key];
  const entry = EMOJI[key] ?? EMOJI[LEGACY_KEY_MAP[key] ?? ""];

  if (!entry) {
    return { unicode: override?.unicode ?? "•", premiumId: override?.tgEmojiId };
  }

  return {
    unicode: override?.unicode?.trim() || entry.unicode,
    premiumId: override?.tgEmojiId?.trim() || entry.premiumId,
  };
}

/**
 * Get Unicode emoji only (for contexts where Premium isn't supported, like button text fallbacks).
 */
export function unicodeOf(key: string, premiumOverrides?: Record<string, { unicode?: string }> | null): string {
  const { unicode } = resolveEmoji(key, premiumOverrides);
  return unicode;
}

/**
 * Build a text line with optional leading emoji as a Premium Custom Emoji entity.
 * Returns { text, entity? } where entity is the custom_emoji entity to attach.
 */
export function emojiEntity(
  key: string,
  rest: string,
  premiumOverrides?: Record<string, { unicode?: string; tgEmojiId?: string }> | null,
): { text: string; entity?: { type: "custom_emoji"; offset: number; length: number; custom_emoji_id: string } } {
  const { unicode, premiumId } = resolveEmoji(key, premiumOverrides);
  const space = rest.startsWith("\n") ? "" : " ";
  const text = unicode + space + rest;

  if (premiumId) {
    // Count UTF-16 code units for the emoji character(s)
    const emojiLen = Array.from(unicode).reduce((len, ch) => {
      const cp = ch.codePointAt(0);
      return len + (cp != null && cp > 0xffff ? 2 : 1);
    }, 0);
    return {
      text,
      entity: { type: "custom_emoji", offset: 0, length: emojiLen, custom_emoji_id: premiumId },
    };
  }
  return { text };
}
