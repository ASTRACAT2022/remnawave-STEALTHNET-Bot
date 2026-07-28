/**
 * Tests for Emoji Registry module.
 * Uses Node.js built-in test runner (node:test).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMOJI, LEGACY_KEY_MAP, resolveEmoji, unicodeOf, emojiEntity } from "./registry.js";

describe("Emoji Registry", () => {
  it("should have all required emoji keys", () => {
    const requiredKeys = [
      "STATUS_ACTIVE", "STATUS_EXPIRED", "STATUS_LIMITED", "STATUS_DISABLED",
      "NAV_BACK", "NAV_HOME",
      "ACTION_BUY", "ACTION_PAY", "ACTION_GIFT",
      "CONTENT_PACKAGE", "CONTENT_LOCATION", "CONTENT_DEVICE",
      "PAY_CARD", "PAY_BALANCE",
    ];
    for (const key of requiredKeys) {
      assert.ok(EMOJI[key], `Missing required emoji key: ${key}`);
    }
  });

  it("every emoji entry should have unicode, label, and category", () => {
    for (const [key, entry] of Object.entries(EMOJI)) {
      assert.ok(typeof entry.unicode === "string" && entry.unicode.length > 0, `${key}: unicode missing or empty`);
      assert.ok(typeof entry.label === "string" && entry.label.length > 0, `${key}: label missing or empty`);
      assert.ok(typeof entry.category === "string", `${key}: category missing`);
    }
  });

  it("should have legacy key mappings for backward compatibility", () => {
    const legacyKeys = ["PACKAGE", "TARIFFS", "CARD", "LINK", "PUZZLE", "PROFILE", "TRIAL", "SERVERS", "CONNECT", "CHART", "STAR", "NOTE", "DEVICES", "BACK"];
    for (const key of legacyKeys) {
      assert.ok(LEGACY_KEY_MAP[key], `Missing legacy key: ${key}`);
      assert.ok(EMOJI[LEGACY_KEY_MAP[key]], `Legacy key ${key} maps to non-existent emoji: ${LEGACY_KEY_MAP[key]}`);
    }
  });
});

describe("resolveEmoji", () => {
  it("should return unicode for known keys", () => {
    const result = resolveEmoji("STATUS_ACTIVE");
    assert.equal(result.unicode, "🟢");
  });

  it("should return fallback for unknown keys", () => {
    const result = resolveEmoji("NONEXISTENT_KEY");
    assert.equal(result.unicode, "•");
  });

  it("should use premium overrides when provided", () => {
    const overrides = { STATUS_ACTIVE: { unicode: "✨", tgEmojiId: "123456" } };
    const result = resolveEmoji("STATUS_ACTIVE", overrides);
    assert.equal(result.unicode, "✨");
    assert.equal(result.premiumId, "123456");
  });

  it("should fallback to default unicode when override has empty unicode", () => {
    const overrides = { STATUS_ACTIVE: { unicode: "", tgEmojiId: "123456" } };
    const result = resolveEmoji("STATUS_ACTIVE", overrides);
    assert.equal(result.unicode, "🟢");
    assert.equal(result.premiumId, "123456");
  });

  it("should resolve legacy keys through LEGACY_KEY_MAP", () => {
    const result = resolveEmoji("PACKAGE");
    assert.equal(result.unicode, "📦");
  });
});

describe("unicodeOf", () => {
  it("should return unicode string for known keys", () => {
    assert.equal(unicodeOf("STATUS_ACTIVE"), "🟢");
    assert.equal(unicodeOf("NAV_BACK"), "◀️");
  });

  it("should return fallback for unknown keys", () => {
    assert.equal(unicodeOf("UNKNOWN"), "•");
  });
});

describe("emojiEntity", () => {
  it("should return text with emoji prefix", () => {
    const result = emojiEntity("STATUS_ACTIVE", "Subscription is active");
    assert.equal(result.text, "🟢 Subscription is active");
  });

  it("should return premium entity when premiumId is available", () => {
    const overrides = { STATUS_ACTIVE: { tgEmojiId: "999999" } };
    const result = emojiEntity("STATUS_ACTIVE", "Active", overrides);
    assert.ok(result.entity);
    assert.equal(result.entity.type, "custom_emoji");
    assert.equal(result.entity.custom_emoji_id, "999999");
    assert.equal(result.entity.offset, 0);
  });

  it("should not return entity for non-premium emojis", () => {
    const result = emojiEntity("STATUS_ACTIVE", "Active");
    assert.equal(result.entity, undefined);
  });

  it("should not add space when text starts with newline", () => {
    const result = emojiEntity("STATUS_ACTIVE", "\nNext line");
    assert.equal(result.text, "🟢\nNext line");
  });
});
