import { describe, it, expect } from "vitest";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

describe("WhatsAppAdapter", () => {
  const adapter = new WhatsAppAdapter({
    token: "test_token",
    phoneNumberId: "123456789",
    appSecret: "test_secret",
    verifyToken: "verify_me",
  });

  describe("parseIncomingMessage", () => {
    it("should parse WhatsApp text message payload", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [{
          id: "123",
          changes: [{
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1234567890", phone_number_id: "123456789" },
              contacts: [{ profile: { name: "John Doe" }, wa_id: "15551234567" }],
              messages: [{
                from: "15551234567",
                id: "wamid.abc123",
                timestamp: "1700000000",
                text: { body: "Pause campaign ABC" },
                type: "text",
              }],
            },
            field: "messages",
          }],
        }],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("Pause campaign ABC");
      expect(msg!.principalId).toBe("15551234567");
      expect(msg!.channel).toBe("whatsapp");
      expect(msg!.threadId).toBe("15551234567");
      expect(msg!.id).toBe("wamid.abc123");
    });

    it("should return null for non-text messages", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [{
          changes: [{
            value: {
              messages: [{
                from: "15551234567",
                id: "wamid.abc123",
                type: "image",
                image: { id: "img_123" },
              }],
            },
          }],
        }],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).toBeNull();
    });

    it("should return null for empty payload", () => {
      expect(adapter.parseIncomingMessage(null)).toBeNull();
      expect(adapter.parseIncomingMessage({})).toBeNull();
      expect(adapter.parseIncomingMessage({ entry: [] })).toBeNull();
    });
  });

  describe("verifyRequest", () => {
    it("should verify valid HMAC-SHA256 signature", () => {
      const { createHmac } = require("node:crypto");
      const body = '{"test": true}';
      const sig = "sha256=" + createHmac("sha256", "test_secret").update(body).digest("hex");

      const result = adapter.verifyRequest(body, { "x-hub-signature-256": sig });
      expect(result).toBe(true);
    });

    it("should reject invalid signature", () => {
      const result = adapter.verifyRequest('{"test": true}', {
        "x-hub-signature-256": "sha256=invalid",
      });
      expect(result).toBe(false);
    });

    it("should reject missing signature", () => {
      const result = adapter.verifyRequest('{"test": true}', {});
      expect(result).toBe(false);
    });

    it("should fail closed when no app secret configured", () => {
      const noSecretAdapter = new WhatsAppAdapter({
        token: "test_token",
        phoneNumberId: "123456789",
      });
      const result = noSecretAdapter.verifyRequest('{"test": true}', {});
      expect(result).toBe(false);
    });
  });

  describe("interactive message parsing", () => {
    it("should parse interactive button_reply messages", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [{
          changes: [{
            value: {
              contacts: [{ profile: { name: "Jane" }, wa_id: "15559876543" }],
              messages: [{
                from: "15559876543",
                id: "wamid.btn123",
                timestamp: "1700000000",
                type: "interactive",
                interactive: {
                  type: "button_reply",
                  button_reply: { id: '{"action":"approve","approvalId":"appr_1","bindingHash":"abc"}', title: "Approve" },
                },
              }],
            },
          }],
        }],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe('{"action":"approve","approvalId":"appr_1","bindingHash":"abc"}');
      expect(msg!.principalId).toBe("15559876543");
      expect(msg!.metadata).toHaveProperty("interactiveType", "button_reply");
    });

    it("should parse interactive list_reply messages", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [{
          changes: [{
            value: {
              messages: [{
                from: "15559876543",
                id: "wamid.list123",
                timestamp: "1700000000",
                type: "interactive",
                interactive: {
                  type: "list_reply",
                  list_reply: { id: "option_1", title: "Option 1" },
                },
              }],
            },
          }],
        }],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("option_1");
    });
  });

  describe("handleVerification", () => {
    it("should respond to valid verification challenge", () => {
      const result = adapter.handleVerification({
        "hub.mode": "subscribe",
        "hub.verify_token": "verify_me",
        "hub.challenge": "challenge_123",
      });

      expect(result.status).toBe(200);
      expect(result.body).toBe("challenge_123");
    });

    it("should reject invalid verify token", () => {
      const result = adapter.handleVerification({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong_token",
        "hub.challenge": "challenge_123",
      });

      expect(result.status).toBe(403);
    });
  });

  describe("extractMessageId", () => {
    it("should extract message ID from webhook payload", () => {
      const payload = {
        entry: [{
          changes: [{
            value: {
              messages: [{ id: "wamid.test123" }],
            },
          }],
        }],
      };

      expect(adapter.extractMessageId(payload)).toBe("wamid.test123");
    });
  });
});
