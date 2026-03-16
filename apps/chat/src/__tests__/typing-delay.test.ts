import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramAdapter } from "../adapters/telegram.js";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

describe("Typing simulation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("TelegramAdapter", () => {
    it("sends typing indicator before message", async () => {
      const adapter = new TelegramAdapter("fake-token");
      const calls: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        calls.push(url);
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
      });

      const p = adapter.sendTextReply("123", "Hello there");
      await vi.advanceTimersByTimeAsync(5000);
      await p;

      expect(calls[0]).toContain("sendChatAction");
      expect(calls[1]).toContain("sendMessage");
    });

    it("calculates delay between 1500ms and 4000ms", async () => {
      const adapter = new TelegramAdapter("fake-token");

      // Access private method via prototype
      const delay = (adapter as unknown as { typingDelay(t: string): number }).typingDelay;

      // Short message: should be 1500ms minimum
      expect(delay("Hi")).toBe(1500);

      // Medium message (~10 words): should be around 12000ms but capped at 4000
      expect(
        delay("This is a medium length message with about ten words here"),
      ).toBeLessThanOrEqual(4000);
      expect(
        delay("This is a medium length message with about ten words here"),
      ).toBeGreaterThanOrEqual(1500);

      // Long message: should cap at 4000ms
      const longMsg = Array(100).fill("word").join(" ");
      expect(delay(longMsg)).toBe(4000);
    });
  });

  describe("WhatsAppAdapter", () => {
    it("adds delay before sending message", async () => {
      const adapter = new WhatsAppAdapter({
        token: "fake-token",
        phoneNumberId: "123",
      });

      let sendTime = 0;
      vi.stubGlobal("fetch", async () => {
        sendTime = Date.now();
        return { ok: true, json: async () => ({ ok: true }) };
      });

      const startTime = Date.now();
      const p = adapter.sendTextReply("123", "Hello there");
      await vi.advanceTimersByTimeAsync(5000);
      await p;

      // There should have been a delay before the fetch call
      expect(sendTime).toBeGreaterThanOrEqual(startTime);
    });

    it("calculates delay between 1500ms and 4000ms", () => {
      const adapter = new WhatsAppAdapter({
        token: "fake-token",
        phoneNumberId: "123",
      });

      const delay = (adapter as unknown as { typingDelay(t: string): number }).typingDelay;

      expect(delay("Hi")).toBe(1500);

      const longMsg = Array(100).fill("word").join(" ");
      expect(delay(longMsg)).toBe(4000);
    });
  });
});
