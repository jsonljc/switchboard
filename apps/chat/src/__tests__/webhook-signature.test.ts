import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { TelegramAdapter } from "../adapters/telegram.js";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

describe("Webhook signature verification", () => {
  describe("TelegramAdapter", () => {
    it("rejects requests with missing secret token header", () => {
      const adapter = new TelegramAdapter("fake-token", undefined, "my-secret");
      const result = adapter.verifyRequest("{}", {});
      expect(result).toBe(false);
    });

    it("rejects requests with wrong secret token", () => {
      const adapter = new TelegramAdapter("fake-token", undefined, "my-secret");
      const result = adapter.verifyRequest("{}", {
        "x-telegram-bot-api-secret-token": "wrong-secret",
      });
      expect(result).toBe(false);
    });

    it("accepts requests with correct secret token", () => {
      const adapter = new TelegramAdapter("fake-token", undefined, "my-secret");
      const result = adapter.verifyRequest("{}", {
        "x-telegram-bot-api-secret-token": "my-secret",
      });
      expect(result).toBe(true);
    });

    it("allows all requests when no secret is configured (dev mode)", () => {
      const adapter = new TelegramAdapter("fake-token");
      const result = adapter.verifyRequest("{}", {});
      expect(result).toBe(true);
    });
  });

  describe("WhatsAppAdapter", () => {
    const appSecret = "whatsapp-app-secret";

    it("rejects requests with missing signature header", () => {
      const adapter = new WhatsAppAdapter({
        token: "fake",
        phoneNumberId: "123",
        appSecret,
      });
      const result = adapter.verifyRequest('{"test": true}', {});
      expect(result).toBe(false);
    });

    it("rejects requests with wrong signature", () => {
      const adapter = new WhatsAppAdapter({
        token: "fake",
        phoneNumberId: "123",
        appSecret,
      });
      const result = adapter.verifyRequest('{"test": true}', {
        "x-hub-signature-256": "sha256=wrong",
      });
      expect(result).toBe(false);
    });

    it("accepts requests with valid HMAC-SHA256 signature", () => {
      const adapter = new WhatsAppAdapter({
        token: "fake",
        phoneNumberId: "123",
        appSecret,
      });
      const body = '{"test": true}';
      const sig = "sha256=" + createHmac("sha256", appSecret).update(body).digest("hex");
      const result = adapter.verifyRequest(body, { "x-hub-signature-256": sig });
      expect(result).toBe(true);
    });

    it("fails closed when no appSecret is configured", () => {
      const adapter = new WhatsAppAdapter({
        token: "fake",
        phoneNumberId: "123",
        // no appSecret
      });
      const result = adapter.verifyRequest('{"test": true}', {});
      expect(result).toBe(false);
    });
  });
});
