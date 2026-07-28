/**
 * Tests for Formatting utilities.
 * Uses Node.js built-in test runner (node:test).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  currencySymbol, formatMoney, formatDate, formatDateTime,
  formatDaysLeft, formatDuration, pluralizeDays,
  bytesToGb, formatTraffic, trafficPercent, progressBar,
  statusEmoji, statusLabel, truncate, sanitizeLabel,
  formatDays, parseExpireAt, daysUntil,
} from "./index.js";

describe("Currency Formatting", () => {
  it("should return correct symbols", () => {
    assert.equal(currencySymbol("RUB"), "₽");
    assert.equal(currencySymbol("USD"), "$");
    assert.equal(currencySymbol("UAH"), "₴");
    assert.equal(currencySymbol("EUR"), "€");
    assert.equal(currencySymbol("usd"), "$"); // case insensitive
  });

  it("should format money with symbol", () => {
    assert.equal(formatMoney(1234, "RUB"), "1234 ₽");
    assert.equal(formatMoney(100, "USD"), "100 $");
  });

  it("should round money amounts", () => {
    assert.equal(formatMoney(99.7, "RUB"), "100 ₽");
    assert.equal(formatMoney(100.3, "USD"), "100 $");
  });
});

describe("Date Formatting", () => {
  it("should format date as DD.MM.YYYY", () => {
    const d = new Date(2025, 0, 15); // Jan 15, 2025
    const result = formatDate(d);
    assert.match(result, /15\.01\.2025/);
  });

  it("should return '—' for invalid dates", () => {
    assert.equal(formatDate(new Date("invalid")), "—");
  });

  it("should format datetime with time", () => {
    const d = new Date(2025, 0, 15, 14, 30);
    const result = formatDateTime(d);
    assert.match(result, /15\.01\.2025/);
    assert.match(result, /14:30/);
  });
});

describe("Day Formatting", () => {
  it("should pluralize days correctly in Russian", () => {
    assert.equal(pluralizeDays(1), "день");
    assert.equal(pluralizeDays(2), "дня");
    assert.equal(pluralizeDays(5), "дней");
    assert.equal(pluralizeDays(11), "дней");
    assert.equal(pluralizeDays(21), "день");
    assert.equal(pluralizeDays(25), "дней");
  });

  it("should format days left", () => {
    assert.equal(formatDaysLeft(5), "5 дней");
    assert.equal(formatDaysLeft(1), "1 день");
  });

  it("should format duration", () => {
    assert.equal(formatDuration(30), "30 дней");
    assert.equal(formatDuration(1), "1 день");
  });

  it("should format days with lang", () => {
    assert.match(formatDays(5, "ru"), /5.*дн/);
    assert.equal(formatDays(5, "en"), "5 days");
    assert.equal(formatDays(1, "en"), "1 day");
  });
});

describe("Traffic Formatting", () => {
  it("should convert bytes to GB", () => {
    const gb = 1024 * 1024 * 1024;
    assert.equal(bytesToGb(gb), "1.00");
    assert.equal(bytesToGb(gb * 5.5), "5.50");
  });

  it("should format traffic usage", () => {
    const used = 1024 * 1024 * 1024; // 1 GB
    const limit = 10 * 1024 * 1024 * 1024; // 10 GB
    assert.equal(formatTraffic(used, limit), "1.00 / 10.00 ГБ");
  });

  it("should calculate traffic percent", () => {
    const used = 5 * 1024 * 1024 * 1024;
    const limit = 10 * 1024 * 1024 * 1024;
    assert.equal(trafficPercent(used, limit), "50%");
  });

  it("should handle zero limit", () => {
    assert.equal(trafficPercent(0, 0), "0%");
  });
});

describe("Progress Bar", () => {
  it("should render filled and empty blocks", () => {
    assert.equal(progressBar(0.5, 10), "█████░░░░░");
    assert.equal(progressBar(0, 5), "░░░░░");
    assert.equal(progressBar(1, 3), "███");
  });

  it("should clamp to 0..1", () => {
    assert.equal(progressBar(1.5, 4), "████");
    assert.equal(progressBar(-0.5, 4), "░░░░");
  });
});

describe("Status", () => {
  it("should map status to emoji", () => {
    assert.equal(statusEmoji("ACTIVE").big, "🟢");
    assert.equal(statusEmoji("ACTIVE").small, "✅");
    assert.equal(statusEmoji("EXPIRED").big, "🔴");
    assert.equal(statusEmoji("EXPIRED").small, "❌");
    assert.equal(statusEmoji("LIMITED").big, "🟡");
    assert.equal(statusEmoji("DISABLED").big, "🔴");
  });

  it("should map status to label", () => {
    assert.equal(statusLabel("ACTIVE", "ru"), "Активна");
    assert.equal(statusLabel("ACTIVE", "en"), "Active");
    assert.equal(statusLabel("EXPIRED", "ru"), "Истекла");
  });
});

describe("Text Utilities", () => {
  it("should truncate long text", () => {
    assert.equal(truncate("Hello World", 6), "Hello…"); // maxLen includes ellipsis
    assert.equal(truncate("Hi", 10), "Hi");
  });

  it("should sanitize label", () => {
    assert.equal(sanitizeLabel("iPhone 15"), "iPhone 15");
    // Remove control characters
    assert.equal(sanitizeLabel("test\x00\x01value"), "testvalue");
  });
});

describe("ExpireAt Parsing", () => {
  it("should parse Unix timestamp", () => {
    const ts = Math.floor(Date.now() / 1000) + 86400; // tomorrow
    const d = parseExpireAt(ts);
    assert.ok(d);
    assert.ok(d.getTime() > Date.now());
  });

  it("should parse ISO string", () => {
    const d = parseExpireAt("2025-06-15T12:00:00Z");
    assert.ok(d);
    assert.equal(d.getFullYear(), 2025);
  });

  it("should return null for invalid", () => {
    assert.equal(parseExpireAt(null), null);
    assert.equal(parseExpireAt("invalid"), null);
  });
});

describe("Days Until", () => {
  it("should calculate days until future date", () => {
    const future = new Date(Date.now() + 5 * 86400000);
    const days = daysUntil(future);
    assert.ok(days !== null && days >= 4 && days <= 5);
  });

  it("should return 0 for past dates", () => {
    const past = new Date(Date.now() - 86400000);
    assert.equal(daysUntil(past), 0);
  });

  it("should return null for invalid dates", () => {
    assert.equal(daysUntil(new Date("invalid")), null);
  });
});
