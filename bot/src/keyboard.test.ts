import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  mainMenu,
  tariffCategoryButtons,
  tariffsOfCategoryButtons,
  tariffPayButtons,
  profileButtons,
  backToSubLabel,
  backToSubsListLabel,
  backButton,
  setProviderLabels,
  type BotButtonConfig,
} from "./keyboard.js";

describe("keyboard", () => {
  // ─── Helper Functions ───
  describe("backToSubLabel()", () => {
    it("returns default label", () => {
      const result = backToSubLabel();
      assert.ok(result.includes("К подписке"));
    });

    it("uses custom emoji from botEmojis", () => {
      const result = backToSubLabel({
        BACK_TO_SUB: { unicode: "🔝" },
      });
      assert.ok(result.includes("🔝"));
      assert.ok(result.includes("К подписке"));
    });
  });

  describe("backToSubsListLabel()", () => {
    it("returns default label", () => {
      const result = backToSubsListLabel();
      assert.ok(result.includes("К списку подписок"));
    });

    it("uses custom emoji from botEmojis", () => {
      const result = backToSubsListLabel({
        BACK_TO_SUBS_LIST: { unicode: "📋" },
      });
      assert.ok(result.includes("📋"));
    });
  });

  describe("backButton()", () => {
    it("returns default back button", () => {
      const result = backButton();
      assert.ok(result.text.includes("Назад"));
      assert.equal(result.iconCustomEmojiId, undefined);
    });

    it("returns custom emoji back button", () => {
      const result = backButton({
        BACK: { unicode: "◀️", tgEmojiId: "123456" },
      });
      assert.ok(result.text.includes("◀️"));
      assert.equal(result.iconCustomEmojiId, "123456");
    });
  });

  // ─── Main Menu ───
  describe("mainMenu()", () => {
    const defaultOpts = {
      showTrial: true,
      showVpn: true,
      appUrl: null,
    };

    it("creates main menu with default buttons", () => {
      const result = mainMenu(defaultOpts);
      assert.ok(result.inline_keyboard);
      assert.ok(result.inline_keyboard.length > 0);
    });

    it("includes tariffs button", () => {
      const result = mainMenu(defaultOpts);
      const flatButtons = result.inline_keyboard.flat();
      const tariffsBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "menu:tariffs");
      assert.ok(tariffsBtn);
    });

    it("includes profile button", () => {
      const result = mainMenu(defaultOpts);
      const flatButtons = result.inline_keyboard.flat();
      const profileBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "menu:profile");
      assert.ok(profileBtn);
    });

    it("hides trial when showTrial=false", () => {
      const result = mainMenu({ ...defaultOpts, showTrial: false });
      const flatButtons = result.inline_keyboard.flat();
      const trialBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "menu:trial");
      assert.equal(trialBtn, undefined);
    });

    it("hides VPN when showVpn=false", () => {
      const result = mainMenu({ ...defaultOpts, showVpn: false });
      const flatButtons = result.inline_keyboard.flat();
      const vpnBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "menu:vpn");
      assert.equal(vpnBtn, undefined);
    });

    it("uses custom button configs", () => {
      const customButtons: BotButtonConfig[] = [
        { id: "tariffs", visible: true, label: "Custom Tariffs", order: 0, style: "success" },
        { id: "profile", visible: true, label: "Custom Profile", order: 1, style: "primary" },
      ];
      const result = mainMenu({ ...defaultOpts, botButtons: customButtons });
      const flatButtons = result.inline_keyboard.flat();
      const tariffsBtn = flatButtons.find((b) => "text" in b && b.text === "Custom Tariffs");
      assert.ok(tariffsBtn);
    });

    it("applies button styles", () => {
      const result = mainMenu(defaultOpts);
      const flatButtons = result.inline_keyboard.flat();
      const tariffsBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "menu:tariffs");
      assert.ok(tariffsBtn);
      if (tariffsBtn && "style" in tariffsBtn) {
        assert.equal(tariffsBtn.style, "success");
      }
    });

    it("supports 2 buttons per row", () => {
      const result = mainMenu({ ...defaultOpts, buttonsPerRow: 2 });
      // Some rows should have 2 buttons
      const hasTwoButtonRow = result.inline_keyboard.some((row) => row.length === 2);
      assert.ok(hasTwoButtonRow);
    });
  });

  // ─── Tariff Categories ───
  describe("tariffCategoryButtons()", () => {
    it("creates category buttons", () => {
      const categories = [
        { id: "cat1", name: "Category 1", emoji: "📦" },
        { id: "cat2", name: "Category 2", emoji: "🌐" },
      ];
      const result = tariffCategoryButtons(categories, "◀️ Назад");
      assert.ok(result.inline_keyboard);
      assert.ok(result.inline_keyboard.length > 0);
    });

    it("includes back button", () => {
      const categories = [
        { id: "cat1", name: "Category 1", emoji: "📦" },
      ];
      const result = tariffCategoryButtons(categories, "◀️ Назад");
      const flatButtons = result.inline_keyboard.flat();
      const backBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "menu:main");
      assert.ok(backBtn);
    });
  });

  // ─── Tariffs of Category ───
  describe("tariffsOfCategoryButtons()", () => {
    it("creates tariff buttons for category", () => {
      const category = {
        name: "Category 1",
        emoji: "📦",
        tariffs: [
          { id: "tariff1", name: "Basic", price: 500, currency: "RUB" },
          { id: "tariff2", name: "Premium", price: 1000, currency: "RUB" },
        ],
      };
      const result = tariffsOfCategoryButtons(category, "◀️ Назад");
      assert.ok(result.inline_keyboard);
      assert.ok(result.inline_keyboard.length > 0);
    });

    it("includes back button", () => {
      const category = {
        name: "Category 1",
        emoji: "📦",
        tariffs: [
          { id: "tariff1", name: "Basic", price: 500, currency: "RUB" },
        ],
      };
      const result = tariffsOfCategoryButtons(category, "◀️ Назад");
      const flatButtons = result.inline_keyboard.flat();
      const backBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "menu:tariffs");
      assert.ok(backBtn);
    });
  });

  // ─── Tariff Pay ───
  describe("tariffPayButtons()", () => {
    it("creates pay buttons from categories", () => {
      const categories = [
        {
          id: "cat1",
          name: "Category 1",
          emoji: "📦",
          tariffs: [
            { id: "tariff1", name: "Basic", price: 500, currency: "RUB" },
          ],
        },
      ];
      const result = tariffPayButtons(categories, "◀️ Назад");
      assert.ok(result.inline_keyboard);
      const flatButtons = result.inline_keyboard.flat();
      const payBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data?.includes("pay_tariff"));
      assert.ok(payBtn);
    });

    it("returns back-only for empty categories", () => {
      const result = tariffPayButtons([], "◀️ Назад");
      const flatButtons = result.inline_keyboard.flat();
      assert.ok(flatButtons.length === 1);
    });
  });

  // ─── Profile ───
  describe("profileButtons()", () => {
    it("creates profile buttons", () => {
      const result = profileButtons(undefined, undefined, undefined, false, "ru");
      assert.ok(result.inline_keyboard);
      assert.ok(result.inline_keyboard.length > 0);
    });

    it("includes language button", () => {
      const result = profileButtons(undefined, undefined, undefined, false, "ru");
      const flatButtons = result.inline_keyboard.flat();
      const langBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "profile:lang");
      assert.ok(langBtn);
    });

    it("includes currency button", () => {
      const result = profileButtons(undefined, undefined, undefined, false, "ru");
      const flatButtons = result.inline_keyboard.flat();
      const currBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "profile:currency");
      assert.ok(currBtn);
    });

    it("shows autorenew ON button when enabled", () => {
      const result = profileButtons(undefined, undefined, undefined, true, "ru");
      const flatButtons = result.inline_keyboard.flat();
      const autoBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "profile:autorenew:off");
      assert.ok(autoBtn);
    });

    it("shows autorenew OFF button when disabled", () => {
      const result = profileButtons(undefined, undefined, undefined, false, "ru");
      const flatButtons = result.inline_keyboard.flat();
      const autoBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "profile:autorenew:on");
      assert.ok(autoBtn);
    });
  });

  // ─── Provider Labels ───
  describe("setProviderLabels()", () => {
    it("sets provider labels", () => {
      setProviderLabels([
        { id: "yookassa", label: "Custom YooKassa" },
      ]);
      // This should not throw
      assert.ok(true);
    });
  });

  // ─── Style Application ───
  describe("style application", () => {
    it("applies success style to CTA buttons", () => {
      const result = mainMenu({ showTrial: true, showVpn: true, appUrl: null });
      const flatButtons = result.inline_keyboard.flat();
      // Tariffs should be success
      const tariffsBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "menu:tariffs");
      assert.ok(tariffsBtn && "style" in tariffsBtn && tariffsBtn.style === "success");
    });

    it("applies danger style to VPN button", () => {
      const result = mainMenu({ showTrial: true, showVpn: true, appUrl: null });
      const flatButtons = result.inline_keyboard.flat();
      // VPN button should be danger
      const vpnBtn = flatButtons.find((b) => "callback_data" in b && b.callback_data === "menu:vpn");
      assert.ok(vpnBtn && "style" in vpnBtn && vpnBtn.style === "danger");
    });
  });
});
