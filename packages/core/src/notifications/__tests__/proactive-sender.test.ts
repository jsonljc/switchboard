import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProactiveSender, WhatsAppWindowClosedError } from "../proactive-sender.js";

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
      expect(url).toBe("https://graph.facebook.com/v21.0/phone_1/messages");
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

    it("throws WhatsAppWindowClosedError when the 24h window is expired (no template)", async () => {
      const sender = new ProactiveSender({
        credentials: { whatsapp: { token: "wa-token", phoneNumberId: "phone_1" } },
        isWithinWindow: async () => false,
      });

      await expect(
        sender.sendProactive("+15551234567", "whatsapp", "We can fit you in at 3pm."),
      ).rejects.toBeInstanceOf(WhatsAppWindowClosedError);
      // The window is closed, so we must NOT silently hit the Graph API and report success.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("masks the recipient phone in the WhatsAppWindowClosedError message", async () => {
      const sender = new ProactiveSender({
        credentials: { whatsapp: { token: "wa-token", phoneNumberId: "phone_1" } },
        isWithinWindow: async () => false,
      });

      const err = await sender
        .sendProactive("+6591234567", "whatsapp", "hi")
        .then(() => null)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(WhatsAppWindowClosedError);
      const message = (err as Error).message;
      expect(message).toContain("…4567");
      expect(message).not.toContain("6591234567");
    });

    it("sends normally when the window is open (isWithinWindow true)", async () => {
      const sender = new ProactiveSender({
        credentials: { whatsapp: { token: "wa-token", phoneNumberId: "phone_1" } },
        isWithinWindow: async () => true,
      });

      await sender.sendProactive("+15551234567", "whatsapp", "in-window msg");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://graph.facebook.com/v21.0/phone_1/messages");
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

    it("throws on non-2xx Telegram response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" });
      const sender = new ProactiveSender({ telegram: { botToken: "t" } });

      await expect(sender.sendProactive("chat_1", "telegram", "test")).rejects.toThrow(
        "Telegram API error: 403 Forbidden",
      );
    });

    it("throws on non-2xx Slack response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });
      const sender = new ProactiveSender({ slack: { botToken: "xoxb-test" } });

      await expect(sender.sendProactive("C12345", "slack", "test")).rejects.toThrow(
        "Slack API error: 500 Internal Server Error",
      );
    });

    it("throws on non-2xx WhatsApp response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
      const sender = new ProactiveSender({
        whatsapp: { token: "wa-token", phoneNumberId: "phone_1" },
      });

      await expect(sender.sendProactive("+15551234567", "whatsapp", "test")).rejects.toThrow(
        "WhatsApp API error: 401 Unauthorized",
      );
    });
  });

  // ── Multi-tenant send (A15) ────────────────────────────────────────
  // sendProactiveForOrg threads the SENDING org through the single notifier:
  // (1) resolves that org's own WhatsApp send creds (per-field fallback to the
  // global env creds), so tenant B's reply ships from tenant B's WABA number;
  // (2) passes the org to the 24h-window gate so the gate reads the replying
  // org's inbound, not the freshest cross-org row. The in-memory daily-rate-limit
  // map is the SAME instance across both entry points (no fresh per-request sender).

  describe("sendProactiveForOrg (multi-tenant)", () => {
    it("sends WhatsApp from the resolved org's own phoneNumberId + token", async () => {
      const sender = new ProactiveSender({
        credentials: { whatsapp: { token: "global-tok", phoneNumberId: "global-pn" } },
        resolveOrgSendCreds: async (org) =>
          org === "orgB" ? { token: "B-tok", phoneNumberId: "B-pn" } : null,
      });

      await sender.sendProactiveForOrg("orgB", "+15551234567", "whatsapp", "from B");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://graph.facebook.com/v21.0/B-pn/messages");
      expect(options.headers.Authorization).toBe("Bearer B-tok");
    });

    it("falls back per-field to the global creds when the org has no connection", async () => {
      const sender = new ProactiveSender({
        credentials: { whatsapp: { token: "global-tok", phoneNumberId: "global-pn" } },
        resolveOrgSendCreds: async () => null,
      });

      await sender.sendProactiveForOrg("orgA", "+15551234567", "whatsapp", "pilot");

      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://graph.facebook.com/v21.0/global-pn/messages");
      expect(options.headers.Authorization).toBe("Bearer global-tok");
    });

    it("falls back ONLY the missing field (org phoneNumberId, global token)", async () => {
      const sender = new ProactiveSender({
        credentials: { whatsapp: { token: "global-tok", phoneNumberId: "global-pn" } },
        // Tech-provider model: org has its own number, token falls back to the global system-user token.
        resolveOrgSendCreds: async () => ({ token: null, phoneNumberId: "B-pn" }),
      });

      await sender.sendProactiveForOrg("orgB", "+15551234567", "whatsapp", "mixed");

      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://graph.facebook.com/v21.0/B-pn/messages");
      expect(options.headers.Authorization).toBe("Bearer global-tok");
    });

    it("passes the sending org to the 24h-window gate", async () => {
      const isWithinWindow = vi.fn(async () => true);
      const sender = new ProactiveSender({
        credentials: { whatsapp: { token: "t", phoneNumberId: "pn" } },
        isWithinWindow,
        resolveOrgSendCreds: async () => null,
      });

      await sender.sendProactiveForOrg("orgB", "+15551234567", "whatsapp", "m");

      expect(isWithinWindow).toHaveBeenCalledWith("+15551234567", "orgB");
    });

    it("throws WhatsAppWindowClosedError when the replying org's window is closed", async () => {
      const sender = new ProactiveSender({
        credentials: { whatsapp: { token: "t", phoneNumberId: "pn" } },
        isWithinWindow: async (_chat, org) => org === "orgOpen",
        resolveOrgSendCreds: async () => null,
      });

      await expect(
        sender.sendProactiveForOrg("orgClosed", "+15551234567", "whatsapp", "m"),
      ).rejects.toBeInstanceOf(WhatsAppWindowClosedError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("shares ONE daily-rate-limit map across sendProactive and sendProactiveForOrg", async () => {
      // No fresh per-request sender: 20 org-blind sends consume the budget; the
      // 21st (org-aware) to the same chatId is rate-limited, proving one map.
      const sender = new ProactiveSender({ telegram: { botToken: "b" } });

      for (let i = 0; i < 20; i++) await sender.sendProactive("chat_1", "telegram", `m${i}`);
      await sender.sendProactiveForOrg("orgB", "chat_1", "telegram", "21st");

      expect(mockFetch).toHaveBeenCalledTimes(20);
    });

    it("warns and skips when neither org nor global creds yield a WhatsApp number", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const sender = new ProactiveSender({
        credentials: {},
        resolveOrgSendCreds: async () => null,
      });

      await sender.sendProactiveForOrg("orgB", "+15551234567", "whatsapp", "m");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No WhatsApp credentials"));
    });
  });
});
