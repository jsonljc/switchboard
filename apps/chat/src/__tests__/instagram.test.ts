import { describe, it, expect } from "vitest";
import { InstagramAdapter } from "../adapters/instagram.js";

describe("InstagramAdapter", () => {
  const adapter = new InstagramAdapter({
    pageAccessToken: "test_page_token",
    appSecret: "test_secret",
    verifyToken: "verify_me",
    channel: "instagram",
  });

  describe("parseIncomingMessage", () => {
    it("should parse Instagram DM text message payload", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "page_123",
            time: 1700000000,
            messaging: [
              {
                sender: { id: "user_456" },
                recipient: { id: "page_123" },
                timestamp: 1700000000000,
                message: {
                  mid: "m_abc123",
                  text: "I want to book an appointment",
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("I want to book an appointment");
      expect(msg!.principalId).toBe("user_456");
      expect(msg!.channel).toBe("instagram");
      expect(msg!.threadId).toBe("user_456");
      expect(msg!.id).toBe("m_abc123");
    });

    it("should parse Messenger text message payload", () => {
      const messengerAdapter = new InstagramAdapter({
        pageAccessToken: "test_page_token",
        appSecret: "test_secret",
        channel: "messenger",
      });

      const payload = {
        object: "page",
        entry: [
          {
            id: "page_789",
            time: 1700000000,
            messaging: [
              {
                sender: { id: "user_101" },
                recipient: { id: "page_789" },
                timestamp: 1700000000000,
                message: {
                  mid: "m_msg001",
                  text: "What are your hours?",
                },
              },
            ],
          },
        ],
      };

      const msg = messengerAdapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("What are your hours?");
      expect(msg!.channel).toBe("messenger");
      expect(msg!.principalId).toBe("user_101");
    });

    it("should parse quick_reply messages", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "page_123",
            time: 1700000000,
            messaging: [
              {
                sender: { id: "user_456" },
                recipient: { id: "page_123" },
                timestamp: 1700000000000,
                message: {
                  mid: "m_qr001",
                  text: "Approve",
                  quick_reply: {
                    payload: '{"action":"approve","approvalId":"appr_1","bindingHash":"abc"}',
                  },
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe('{"action":"approve","approvalId":"appr_1","bindingHash":"abc"}');
      expect(msg!.metadata).toHaveProperty("type", "quick_reply");
    });

    it("should parse postback messages", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "page_123",
            time: 1700000000,
            messaging: [
              {
                sender: { id: "user_456" },
                recipient: { id: "page_123" },
                timestamp: 1700000000000,
                postback: {
                  title: "Get Started",
                  payload: "GET_STARTED",
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("GET_STARTED");
      expect(msg!.metadata).toHaveProperty("type", "postback");
    });

    it("should return null for non-text messages (e.g. attachments only)", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "page_123",
            messaging: [
              {
                sender: { id: "user_456" },
                recipient: { id: "page_123" },
                timestamp: 1700000000000,
                message: {
                  mid: "m_img001",
                  attachments: [{ type: "image", payload: { url: "https://example.com/img.jpg" } }],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).toBeNull();
    });

    it("should return null for empty or invalid payloads", () => {
      expect(adapter.parseIncomingMessage(null)).toBeNull();
      expect(adapter.parseIncomingMessage({})).toBeNull();
      expect(adapter.parseIncomingMessage({ entry: [] })).toBeNull();
      expect(
        adapter.parseIncomingMessage({
          entry: [{ messaging: [] }],
        }),
      ).toBeNull();
    });

    it("should return null when sender is missing", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            messaging: [
              {
                recipient: { id: "page_123" },
                timestamp: 1700000000000,
                message: { mid: "m_nosender", text: "hello" },
              },
            ],
          },
        ],
      };
      expect(adapter.parseIncomingMessage(payload)).toBeNull();
    });
  });

  describe("verifyRequest", () => {
    it("should verify valid HMAC-SHA256 signature", () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
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
      const noSecretAdapter = new InstagramAdapter({
        pageAccessToken: "test_page_token",
      });
      const result = noSecretAdapter.verifyRequest('{"test": true}', {});
      expect(result).toBe(false);
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
        entry: [
          {
            messaging: [
              {
                message: { mid: "m_test123" },
              },
            ],
          },
        ],
      };

      expect(adapter.extractMessageId(payload)).toBe("m_test123");
    });

    it("should return null when message is missing", () => {
      expect(adapter.extractMessageId({})).toBeNull();
      expect(adapter.extractMessageId({ entry: [{ messaging: [{}] }] })).toBeNull();
    });
  });

  describe("referral extraction", () => {
    it("should extract referral data from text messages", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "page_123",
            time: 1700000000,
            messaging: [
              {
                sender: { id: "user_ad" },
                recipient: { id: "page_123" },
                timestamp: 1700000000000,
                message: {
                  mid: "m_ref001",
                  text: "Interested in your services",
                },
                referral: {
                  ad_id: "ig_ad_456",
                  source: "ig_story",
                  type: "OPEN_THREAD",
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.metadata).toHaveProperty("sourceAdId", "ig_ad_456");
      expect(msg!.metadata).toHaveProperty("utmSource", "ig_story");
      expect(msg!.metadata).toHaveProperty("adSourceType", "OPEN_THREAD");
    });

    it("should extract referral data from postback messages", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "page_123",
            time: 1700000000,
            messaging: [
              {
                sender: { id: "user_ad" },
                recipient: { id: "page_123" },
                timestamp: 1700000000000,
                postback: {
                  title: "Get Started",
                  payload: "GET_STARTED",
                },
                referral: {
                  ad_id: "ig_ad_789",
                  source: "ig_feed",
                  type: "OPEN_THREAD",
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("GET_STARTED");
      expect(msg!.metadata).toHaveProperty("type", "postback");
      expect(msg!.metadata).toHaveProperty("sourceAdId", "ig_ad_789");
      expect(msg!.metadata).toHaveProperty("utmSource", "ig_feed");
    });

    it("should extract referral data from quick_reply messages", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "page_123",
            time: 1700000000,
            messaging: [
              {
                sender: { id: "user_ad" },
                recipient: { id: "page_123" },
                timestamp: 1700000000000,
                message: {
                  mid: "m_qr_ref",
                  text: "Book",
                  quick_reply: { payload: "BOOK_NOW" },
                },
                referral: {
                  ad_id: "ig_ad_qr",
                  source: "ig_explore",
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("BOOK_NOW");
      expect(msg!.metadata).toHaveProperty("type", "quick_reply");
      expect(msg!.metadata).toHaveProperty("sourceAdId", "ig_ad_qr");
      expect(msg!.metadata).toHaveProperty("utmSource", "ig_explore");
    });

    it("should not include referral fields when referral is absent", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "page_123",
            time: 1700000000,
            messaging: [
              {
                sender: { id: "user_456" },
                recipient: { id: "page_123" },
                timestamp: 1700000000000,
                message: {
                  mid: "m_noref",
                  text: "Normal message",
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.metadata).not.toHaveProperty("sourceAdId");
      expect(msg!.metadata).not.toHaveProperty("utmSource");
    });
  });
});

describe("ChannelGateway detection", () => {
  it("should detect Instagram payloads by object=instagram", async () => {
    const { ChannelGateway } = await import("../adapters/gateway.js");

    const gateway = new ChannelGateway();
    const igAdapter = new InstagramAdapter({
      pageAccessToken: "test",
      channel: "instagram",
    });
    gateway.register(igAdapter);

    const payload = {
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "u1" }, message: { text: "hi" } }] }],
    };

    const result = gateway.detect(payload);
    expect(result).not.toBeNull();
    expect(result!.channel).toBe("instagram");
  });

  it("should detect Messenger payloads by object=page", async () => {
    const { ChannelGateway } = await import("../adapters/gateway.js");

    const gateway = new ChannelGateway();
    const msgAdapter = new InstagramAdapter({
      pageAccessToken: "test",
      channel: "messenger",
    });
    gateway.register(msgAdapter);

    const payload = {
      object: "page",
      entry: [{ messaging: [{ sender: { id: "u1" }, message: { text: "hi" } }] }],
    };

    const result = gateway.detect(payload);
    expect(result).not.toBeNull();
    expect(result!.channel).toBe("messenger");
  });
});
