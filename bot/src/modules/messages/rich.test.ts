import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  createRichList,
  createKeyValueDisplay,
  createStatusCard,
  createCollapsibleSection,
  createTable,
  createProgressBar,
  createMultiSection,
  createQuickActions,
  createInfoMessage,
} from "./rich.js";

describe("messages/rich", () => {
  describe("createRichList()", () => {
    it("creates list with emoji bullets", () => {
      const msg = createRichList([
        { text: "Basic Plan", emoji: "📦" },
        { text: "Premium Plan", emoji: "⭐" },
      ]);
      assert.ok(msg.text.includes("📦 Basic Plan"));
      assert.ok(msg.text.includes("⭐ Premium Plan"));
    });

    it("creates list with emoji keys", () => {
      const msg = createRichList([
        { text: "Item 1", emojiKey: "CONTENT_PACKAGE" },
      ]);
      assert.ok(msg.text.includes("📦"));
    });

    it("adds detail text", () => {
      const msg = createRichList([
        { text: "Plan", detail: "500 ₽" },
      ]);
      assert.ok(msg.text.includes("Plan — 500 ₽"));
    });

    it("applies bold formatting", () => {
      const msg = createRichList([
        { text: "Bold Item", bold: true },
      ]);
      const boldEntity = msg.entities.find((e) => e.type === "bold");
      assert.ok(boldEntity);
      assert.equal(boldEntity.length, "Bold Item".length);
    });

    it("applies code formatting", () => {
      const msg = createRichList([
        { text: "code", code: true },
      ]);
      const codeEntity = msg.entities.find((e) => e.type === "code");
      assert.ok(codeEntity);
    });
  });

  describe("createKeyValueDisplay()", () => {
    it("creates key-value pairs", () => {
      const msg = createKeyValueDisplay([
        { key: "Balance", value: "1000 ₽" },
      ]);
      assert.ok(msg.text.includes("Balance:"));
      assert.ok(msg.text.includes("1000 ₽"));
    });

    it("bolds key text", () => {
      const msg = createKeyValueDisplay([
        { key: "Key", value: "Value" },
      ]);
      const boldEntity = msg.entities.find((e) => e.type === "bold");
      assert.ok(boldEntity);
    });

    it("bolds value when requested", () => {
      const msg = createKeyValueDisplay([
        { key: "Key", value: "Value", boldValue: true },
      ]);
      const boldEntities = msg.entities.filter((e) => e.type === "bold");
      assert.ok(boldEntities.length >= 2);
    });

    it("adds code formatting to value", () => {
      const msg = createKeyValueDisplay([
        { key: "Code", value: "abc123", codeValue: true },
      ]);
      const codeEntity = msg.entities.find((e) => e.type === "code");
      assert.ok(codeEntity);
    });

    it("includes emoji prefix", () => {
      const msg = createKeyValueDisplay([
        { key: "Balance", value: "1000", emojiKey: "PAY_BALANCE" },
      ]);
      assert.ok(msg.text.includes("💰"));
    });
  });

  describe("createStatusCard()", () => {
    it("creates active status card", () => {
      const msg = createStatusCard({
        status: "active",
        title: "Subscription",
        subtitle: "Active",
      });
      assert.ok(msg.text.includes("🟢"));
      assert.ok(msg.text.includes("Subscription"));
      assert.ok(msg.text.includes("Active"));
    });

    it("creates expired status card", () => {
      const msg = createStatusCard({
        status: "expired",
        title: "Subscription",
      });
      assert.ok(msg.text.includes("🔴"));
    });

    it("adds details section", () => {
      const msg = createStatusCard({
        status: "active",
        title: "Plan",
        details: [
          { key: "Traffic", value: "50 GB" },
          { key: "Devices", value: "3" },
        ],
      });
      assert.ok(msg.text.includes("Traffic:"));
      assert.ok(msg.text.includes("50 GB"));
    });

    it("adds expiry info with daysLeft", () => {
      const msg = createStatusCard({
        status: "active",
        title: "Plan",
        daysLeft: 15,
      });
      assert.ok(msg.text.includes("15"));
      assert.ok(msg.text.includes("дн."));
    });

    it("adds expiry info with expiresAt", () => {
      const msg = createStatusCard({
        status: "active",
        title: "Plan",
        expiresAt: new Date("2024-02-01"),
      });
      assert.ok(msg.text.includes("01.02.2024"));
    });
  });

  describe("createCollapsibleSection()", () => {
    it("creates section with title and content", () => {
      const msg = createCollapsibleSection({
        title: "Details",
        content: ["Line 1", "Line 2"],
      });
      assert.ok(msg.text.includes("▎ Details"));
      assert.ok(msg.text.includes("▸ Line 1"));
      assert.ok(msg.text.includes("▸ Line 2"));
    });

    it("bolds title", () => {
      const msg = createCollapsibleSection({
        title: "Section",
        content: ["Content"],
      });
      const boldEntity = msg.entities.find((e) => e.type === "bold");
      assert.ok(boldEntity);
    });
  });

  describe("createTable()", () => {
    it("creates table with headers and rows", () => {
      const msg = createTable(
        ["Name", "Price"],
        [
          ["Basic", "300 ₽"],
          ["Premium", "800 ₽"],
        ],
      );
      assert.ok(msg.text.includes("Name | Price"));
      assert.ok(msg.text.includes("Basic | 300 ₽"));
      assert.ok(msg.text.includes("Premium | 800 ₽"));
    });

    it("bolds headers", () => {
      const msg = createTable(["H1", "H2"], [["A", "B"]]);
      const boldEntity = msg.entities.find((e) => e.type === "bold");
      assert.ok(boldEntity);
    });
  });

  describe("createProgressBar()", () => {
    it("creates progress bar", () => {
      const msg = createProgressBar(50, 100);
      assert.ok(msg.text.includes("█"));
      assert.ok(msg.text.includes("50%"));
    });

    it("creates full bar at 100%", () => {
      const msg = createProgressBar(100, 100, undefined, 5);
      assert.ok(msg.text.includes("█████"));
    });

    it("creates empty bar at 0%", () => {
      const msg = createProgressBar(0, 100, undefined, 5);
      assert.ok(msg.text.includes("░░░░░"));
    });

    it("adds label when provided", () => {
      const msg = createProgressBar(75, 100, "Traffic");
      assert.ok(msg.text.includes("Traffic:"));
    });

    it("shows current/total", () => {
      const msg = createProgressBar(25, 100);
      assert.ok(msg.text.includes("25 / 100"));
    });
  });

  describe("createMultiSection()", () => {
    it("creates multiple sections with separators", () => {
      const msg = createMultiSection([
        { title: "Section 1", content: ["Content 1"] },
        { title: "Section 2", content: ["Content 2"] },
      ]);
      assert.ok(msg.text.includes("Section 1"));
      assert.ok(msg.text.includes("Section 2"));
      assert.ok(msg.text.includes("Content 1"));
      assert.ok(msg.text.includes("Content 2"));
      // Should have separators between sections
      assert.ok(msg.text.includes("─────────────────"));
    });
  });

  describe("createQuickActions()", () => {
    it("creates action list", () => {
      const msg = createQuickActions([
        { emoji: "📦", text: "Plans", detail: "Choose" },
        { emoji: "💳", text: "Pay", detail: "Top up" },
      ]);
      assert.ok(msg.text.includes("📦 Plans — Choose"));
      assert.ok(msg.text.includes("💳 Pay — Top up"));
    });

    it("bolds text part", () => {
      const msg = createQuickActions([
        { text: "Action" },
      ]);
      const boldEntity = msg.entities.find((e) => e.type === "bold");
      assert.ok(boldEntity);
    });

    it("uses emoji keys", () => {
      const msg = createQuickActions([
        { emojiKey: "CONTENT_PACKAGE", text: "Plans" },
      ]);
      assert.ok(msg.text.includes("📦"));
    });
  });

  describe("createInfoMessage()", () => {
    it("creates info message with title and content", () => {
      const msg = createInfoMessage(
        "How to use",
        ["Step 1", "Step 2", "Step 3"],
      );
      assert.ok(msg.text.includes("How to use"));
      assert.ok(msg.text.includes("Step 1"));
      assert.ok(msg.text.includes("Step 2"));
      assert.ok(msg.text.includes("Step 3"));
    });

    it("adds tip when provided", () => {
      const msg = createInfoMessage(
        "Title",
        ["Content"],
        "This is a tip",
      );
      assert.ok(msg.text.includes("💡"));
      assert.ok(msg.text.includes("This is a tip"));
    });

    it("bolds title", () => {
      const msg = createInfoMessage("Title", []);
      const boldEntity = msg.entities.find((e) => e.type === "bold");
      assert.ok(boldEntity);
    });
  });
});
