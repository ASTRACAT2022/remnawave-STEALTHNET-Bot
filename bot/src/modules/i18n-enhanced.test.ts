import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  t, emoji, tWithEmoji, formatDays, pluralize,
  formatMoney, formatTraffic, formatDate, formatDateTime,
  bold, code, spoiler, kvLine, separator, statusLine,
  setTranslations, RU,
} from "../i18n-enhanced.js";

describe("i18n-enhanced", () => {
  // ─── Core Translation ───
  describe("t()", () => {
    it("returns Russian text by default", () => {
      const result = t("menu.btn_tariffs");
      assert.ok(result.includes("Тарифы"));
    });

    it("returns English text when lang=en", () => {
      const result = t("menu.btn_tariffs", "en");
      assert.ok(result.includes("Plans"));
    });

    it("replaces template variables", () => {
      const result = t("tariffs.traffic_limit", "ru", { gb: 50 });
      assert.ok(result.includes("50"));
      assert.ok(result.includes("GB"));
    });

    it("falls back to key if not found", () => {
      const result = t("nonexistent.key", "ru");
      assert.equal(result, "nonexistent.key");
    });

    it("handles nested keys", () => {
      const result = t("admin.btn_stats", "en");
      assert.ok(result.includes("Statistics"));
    });
  });

  // ─── Emoji Integration ───
  describe("emoji()", () => {
    it("returns unicode for known keys", () => {
      const result = emoji("STATUS_ACTIVE");
      assert.equal(result, "🟢");
    });

    it("returns unicode for legacy keys", () => {
      const result = emoji("CARD");
      assert.equal(result, "💳");
    });

    it("returns bullet for unknown keys", () => {
      const result = emoji("UNKNOWN_KEY");
      assert.equal(result, "•");
    });
  });

  describe("tWithEmoji()", () => {
    it("combines emoji and translated text", () => {
      const result = tWithEmoji("STATUS_ACTIVE", "profile.title", "ru");
      assert.ok(result.includes("🟢"));
      assert.ok(result.includes("Профиль"));
    });

    it("works with English", () => {
      const result = tWithEmoji("STATUS_ACTIVE", "profile.title", "en");
      assert.ok(result.includes("🟢"));
      assert.ok(result.includes("Profile"));
    });
  });

  // ─── Pluralization ───
  describe("formatDays()", () => {
    it("formats Russian day singular", () => {
      const result = formatDays(1, "ru");
      assert.ok(result.includes("1"));
      assert.ok(result.includes("день"));
    });

    it("formats Russian day few", () => {
      const result = formatDays(3, "ru");
      assert.ok(result.includes("3"));
      assert.ok(result.includes("дня"));
    });

    it("formats Russian day many", () => {
      const result = formatDays(5, "ru");
      assert.ok(result.includes("5"));
      assert.ok(result.includes("дней"));
    });

    it("formats English days", () => {
      const result = formatDays(5, "en");
      assert.ok(result.includes("5"));
      assert.ok(result.includes("days"));
    });

    it("formats English singular day", () => {
      const result = formatDays(1, "en");
      assert.ok(result.includes("1"));
      assert.ok(result.includes("day"));
    });
  });

  describe("pluralize()", () => {
    it("returns one form for 1", () => {
      assert.equal(pluralize(1, "день", "дня", "дней"), "день");
    });

    it("returns few form for 3", () => {
      assert.equal(pluralize(3, "день", "дня", "дней"), "дня");
    });

    it("returns many form for 5", () => {
      assert.equal(pluralize(5, "день", "дня", "дней"), "дней");
    });

    it("returns many form for 11", () => {
      assert.equal(pluralize(11, "день", "дня", "дней"), "дней");
    });

    it("returns few form for 22", () => {
      assert.equal(pluralize(22, "день", "дня", "дней"), "дня");
    });
  });

  // ─── Formatting Helpers ───
  describe("formatMoney()", () => {
    it("formats RUB with symbol", () => {
      const result = formatMoney(1000, "RUB");
      assert.ok(result.includes("1"));
      assert.ok(result.includes("₽"));
    });

    it("formats USD", () => {
      const result = formatMoney(50, "USD");
      assert.ok(result.includes("$"));
    });

    it("formats unknown currency", () => {
      const result = formatMoney(100, "BTC");
      assert.ok(result.includes("BTC"));
    });
  });

  describe("formatTraffic()", () => {
    it("formats bytes", () => {
      assert.equal(formatTraffic(0), "0 B");
    });

    it("formats MB", () => {
      const result = formatTraffic(500 * 1024 * 1024);
      assert.ok(result.includes("MB"));
    });

    it("formats GB", () => {
      const result = formatTraffic(5 * 1024 * 1024 * 1024);
      assert.ok(result.includes("GB"));
    });
  });

  describe("formatDate()", () => {
    it("formats date in Russian", () => {
      const result = formatDate(new Date("2024-01-15"), "ru");
      assert.ok(result.includes("2024"));
    });

    it("formats date in English", () => {
      const result = formatDate(new Date("2024-01-15"), "en");
      assert.ok(result.includes("2024"));
    });

    it("formats timestamp", () => {
      const result = formatDate(1705276800, "en"); // 2024-01-15
      assert.ok(result.includes("2024"));
    });
  });

  describe("formatDateTime()", () => {
    it("formats datetime", () => {
      const result = formatDateTime(new Date("2024-01-15T14:30:00"), "en");
      assert.ok(result.includes("2024"));
      assert.ok(result.includes("14") || result.includes("02"));
    });
  });

  // ─── Rich Message Helpers ───
  describe("bold()", () => {
    it("wraps text in bold markers", () => {
      const result = bold("Hello");
      assert.equal(result, "*Hello*");
    });

    it("escapes special characters", () => {
      const result = bold("Hello *world");
      assert.equal(result, "*Hello \\*world*");
    });
  });

  describe("code()", () => {
    it("wraps text in code markers", () => {
      const result = code("echo");
      assert.equal(result, "`echo`");
    });
  });

  describe("spoiler()", () => {
    it("wraps text in spoiler markers", () => {
      const result = spoiler("secret");
      assert.equal(result, "||secret||");
    });
  });

  describe("kvLine()", () => {
    it("creates key-value line", () => {
      const result = kvLine("Balance", "1000 ₽");
      assert.ok(result.includes("*Balance:*"));
      assert.ok(result.includes("1000 ₽"));
    });

    it("includes emoji prefix when provided", () => {
      const result = kvLine("Balance", "1000 ₽", "PAY_BALANCE");
      assert.ok(result.includes("💰"));
      assert.ok(result.includes("*Balance:*"));
    });
  });

  describe("separator()", () => {
    it("creates separator line", () => {
      const result = separator();
      assert.equal(result.length, 20);
    });

    it("creates custom separator", () => {
      const result = separator("=", 10);
      assert.equal(result, "==========");
    });
  });

  describe("statusLine()", () => {
    it("creates active status line", () => {
      const result = statusLine("active", "Subscription");
      assert.ok(result.includes("🟢"));
      assert.ok(result.includes("*Subscription*"));
    });

    it("creates expired status line", () => {
      const result = statusLine("expired", "Subscription");
      assert.ok(result.includes("🔴"));
    });

    it("includes details when provided", () => {
      const result = statusLine("active", "Subscription", "Expires: 2024-01-01");
      assert.ok(result.includes("Expires: 2024-01-01"));
    });
  });

  // ─── Translation Loading ───
  describe("setTranslations()", () => {
    it("loads external translations", () => {
      setTranslations({
        de: {
          bot: {
            "menu.btn_tariffs": "Deutsche Tarife",
          },
        },
      });
      const result = t("menu.btn_tariffs", "de");
      assert.ok(result.includes("Deutsche Tarife"));
    });

    it("clears translations when undefined", () => {
      setTranslations(undefined);
      const result = t("menu.btn_tariffs", "de");
      // Should fall back to Russian
      assert.ok(result.includes("Тарифы"));
    });
  });

  // ─── RU Object ───
  describe("RU translations", () => {
    it("has required keys", () => {
      assert.ok(RU["menu.btn_tariffs"]);
      assert.ok(RU["back_to_menu"]);
      assert.ok(RU["error_generic"]);
    });

    it("has consistent emoji in keys", () => {
      // Check some keys have emoji
      assert.ok(RU["menu.btn_tariffs"].includes("📦"));
      assert.ok(RU["menu.btn_profile"].includes("👤"));
    });
  });
});
