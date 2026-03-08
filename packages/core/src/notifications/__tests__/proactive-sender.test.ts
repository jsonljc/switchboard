import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProactiveSender } from "../proactive-sender.js";

// Mock global fetch
const mockFetch = vi.fn();

describe("ProactiveSender", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Telegram ───────────────────────────────────────────────────────

  describe("telegram", () => {
    it("sends a message via Telegram Bot API", async () => {
      const sender = new ProactiveSender({ telegram: { botToken: "test-token" } });

      await sender.sendProactive("chat_123", "telegram", "Hello from agent");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
      expect(options.method).toBe("POST");
      const body = JSON.parse(options.body as string);
      expect(body.chat_id).toBe("chat_123");
      expect(body.text).toBe("Hello from agent");
      expect(body.parse_mode).toBe("Markdown");
    });

    it("warns and skips when no Telegram credentials", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const sender = new ProactiveSender({});

      await sender.sendProactive("chat_123", "telegram", "test");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No Telegram credentials"));
    });
  });

  // ── Slack ──────────────────────────────────────────────────────────

  describe("slack", () => {
    it("sends a message via Slack API", async () => {
      const sender = new ProactiveSender({ slack: { botToken: "xoxb-test" } });

      await sender.sendProactive("C12345", "slack", "Slack alert");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://slack.com/api/chat.postMessage");
      expect(options.headers.Authorization).toBe("Bearer xoxb-test");
      const body = JSON.parse(options.body as string);
      expect(body.channel).toBe("C12345");
      expect(body.text).toBe("Slack alert");
    });

    it("warns and skips when no Slack credentials", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const sender = new ProactiveSender({});

      await sender.sendProactive("C12345", "slack", "test");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No Slack credentials"));
    });
  });

  // ── WhatsApp ───────────────────────────────────────────────────────

  describe("whatsapp", () => {
    it("sends a message via WhatsApp Graph API", async () => {
      const sender = new ProactiveSender({
        whatsapp: { token: "wa-token", phoneNumberId: "phone_1" },
      });

      await sender.sendProactive("+15551234567", "whatsapp", "WhatsApp msg");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://graph.facebook.com/v18.0/phone_1/messages");
      expect(options.headers.Authorization).toBe("Bearer wa-token");
      const body = JSON.parse(options.body as string);
      expect(body.to).toBe("+15551234567");
      expect(body.text.body).toBe("WhatsApp msg");
      expect(body.messaging_product).toBe("whatsapp");
    });

    it("warns and skips when no WhatsApp credentials", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const sender = new ProactiveSender({});

      await sender.sendProactive("+15551234567", "whatsapp", "test");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No WhatsApp credentials"));
    });
  });

  // ── Unknown channel ────────────────────────────────────────────────

  describe("unknown channel", () => {
    it("warns on unknown channel type", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const sender = new ProactiveSender({ telegram: { botToken: "t" } });

      await sender.sendProactive("chat_1", "carrier-pigeon", "coo coo");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown channel type"));
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────

  describe("rate limiting", () => {
    it("allows up to 20 messages per chat per day", async () => {
      const sender = new ProactiveSender({ telegram: { botToken: "t" } });

      for (let i = 0; i < 20; i++) {
        await sender.sendProactive("chat_1", "telegram", `msg ${i}`);
      }

      expect(mockFetch).toHaveBeenCalledTimes(20);
    });

    it("blocks messages after 20 per chat", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const sender = new ProactiveSender({ telegram: { botToken: "t" } });

      for (let i = 0; i < 21; i++) {
        await sender.sendProactive("chat_1", "telegram", `msg ${i}`);
      }

      // 20 sent, 21st blocked
      expect(mockFetch).toHaveBeenCalledTimes(20);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Rate limit reached"));
    });

    it("tracks rate limits per chat independently", async () => {
      const sender = new ProactiveSender({ telegram: { botToken: "t" } });

      for (let i = 0; i < 20; i++) {
        await sender.sendProactive("chat_1", "telegram", `msg ${i}`);
      }
      await sender.sendProactive("chat_2", "telegram", "first message");

      // 20 for chat_1 + 1 for chat_2
      expect(mockFetch).toHaveBeenCalledTimes(21);
    });
  });

  // ── Fetch errors ───────────────────────────────────────────────────

  describe("fetch errors", () => {
    it("propagates fetch errors (caller handles)", async () => {
      mockFetch.mockRejectedValue(new Error("network down"));
      const sender = new ProactiveSender({ telegram: { botToken: "t" } });

      await expect(sender.sendProactive("chat_1", "telegram", "test")).rejects.toThrow(
        "network down",
      );
    });
  });
});
