/**
 * STEALTHNET — Message builders
 *
 * Unified message construction for all bot screens.
 * Uses Telegram entities (not parse_mode) for rich text.
 * Supports custom_emoji, bold, strikethrough, code.
 */

// ─── Types ───

export type BotEntity =
  | { type: "custom_emoji"; offset: number; length: number; custom_emoji_id: string }
  | { type: "bold"; offset: number; length: number }
  | { type: "strikethrough"; offset: number; length: number }
  | { type: "code"; offset: number; length: number }
  | { type: "underline"; offset: number; length: number }
  | { type: "spoiler"; offset: number; length: number };

export interface MessageBuilder {
  text: string;
  entities: BotEntity[];
}

/** Create an empty message builder */
export function createMessage(): MessageBuilder {
  return { text: "", entities: [] };
}

/** Append a plain line */
export function pushLine(builder: MessageBuilder, line: string): void {
  if (builder.text.length > 0) builder.text += "\n";
  builder.text += line;
}

/** Append a bold line */
export function pushBold(builder: MessageBuilder, text: string): void {
  const prefix = builder.text.length > 0 ? "\n" : "";
  const offset = builder.text.length + prefix.length;
  builder.text += prefix + text;
  builder.entities.push({ type: "bold", offset, length: text.length });
}

/** Append a code block (tap to copy) */
export function pushCode(builder: MessageBuilder, text: string): void {
  const prefix = builder.text.length > 0 ? "\n" : "";
  const offset = builder.text.length + prefix.length;
  builder.text += prefix + text;
  builder.entities.push({ type: "code", offset, length: text.length });
}

/** Append a Premium Custom Emoji */
export function pushEmoji(builder: MessageBuilder, unicode: string, premiumId: string): void {
  const prefix = builder.text.length > 0 ? "" : "";
  const offset = builder.text.length + prefix.length;
  builder.text += prefix + unicode;
  // Count UTF-16 code units
  const len = Array.from(unicode).reduce((l, ch) => {
    const cp = ch.codePointAt(0);
    return l + (cp != null && cp > 0xffff ? 2 : 1);
  }, 0);
  builder.entities.push({ type: "custom_emoji", offset, length: len, custom_emoji_id: premiumId });
}

/** Append a separator line */
export function pushSeparator(builder: MessageBuilder): void {
  pushLine(builder, "─────────────────");
}

/** Append a line with a leading emoji + text, with optional Premium Emoji entity */
export function pushEmojiLine(
  builder: MessageBuilder,
  unicode: string,
  text: string,
  premiumId?: string,
): void {
  const prefix = builder.text.length > 0 ? "\n" : "";
  const offset = builder.text.length + prefix.length;
  const space = text.startsWith("\n") ? "" : " ";
  const line = unicode + space + text;
  builder.text += prefix + line;

  if (premiumId) {
    const emojiLen = Array.from(unicode).reduce((l, ch) => {
      const cp = ch.codePointAt(0);
      return l + (cp != null && cp > 0xffff ? 2 : 1);
    }, 0);
    builder.entities.push({ type: "custom_emoji", offset, length: emojiLen, custom_emoji_id: premiumId });
  }
}

/** Append a line with leading emoji from registry + text */
export function pushEmojiKeyLine(
  builder: MessageBuilder,
  emoji: { unicode: string; premiumId?: string },
  text: string,
): void {
  pushEmojiLine(builder, emoji.unicode, text, emoji.premiumId);
}

// ─── Markdown Parser ───

/**
 * Parse **bold** and `code` markdown in text, merging with existing entities.
 * Single-pass for correct offsets.
 */
export function parseMarkdown(
  raw: string,
  existingEntities: BotEntity[] = [],
  baseOffset: number = 0,
): MessageBuilder {
  const result = createMessage();
  let i = 0;
  const n = raw.length;

  // First, process existing entities to get their text content
  let out = "";
  while (i < n) {
    // **bold**
    if (raw[i] === "*" && raw[i + 1] === "*") {
      const end = raw.indexOf("**", i + 2);
      if (end > i + 2) {
        const inner = raw.slice(i + 2, end);
        const off = result.text.length;
        result.text += inner;
        result.entities.push({ type: "bold", offset: off, length: inner.length });
        i = end + 2;
        continue;
      }
    }
    // `code`
    if (raw[i] === "`") {
      const end = raw.indexOf("`", i + 1);
      if (end > i + 1) {
        const inner = raw.slice(i + 1, end);
        const off = result.text.length;
        result.text += inner;
        result.entities.push({ type: "code", offset: off, length: inner.length });
        i = end + 1;
        continue;
      }
    }
    result.text += raw[i];
    i++;
  }

  // Shift existing entities
  for (const e of existingEntities) {
    result.entities.push({ ...e, offset: e.offset + baseOffset });
  }

  return result;
}

/**
 * Merge two MessageBuilders, adjusting offsets of the second.
 */
export function mergeMessages(a: MessageBuilder, b: MessageBuilder): MessageBuilder {
  const offset = a.text.length > 0 ? a.text.length : 0; // +1 for \n if needed
  return {
    text: a.text + (a.text.length > 0 && b.text.length > 0 ? "\n" : "") + b.text,
    entities: [
      ...a.entities,
      ...b.entities.map((e) => ({ ...e, offset: e.offset + (a.text.length > 0 && b.text.length > 0 ? a.text.length + 1 : 0) })),
    ],
  };
}
