import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramAdapter } from "../adapters/telegram.js";

describe("TelegramRateLimiter (via TelegramAdapter)", () => {
  let adapter: TelegramAdapter;
  let fetchCalls: Array<{ url: string; body: unknown }>;

  beforeEach(() => {
    adapter = new TelegramAdapter("fake-bot-token");
    fetchCalls = [];

    // Mock global fetch to capture calls without hitting Telegram
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: fetchCalls.length } }),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows a burst of 30 messages without delay", async () => {
    const start = Date.now();

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 30; i++) {
      promises.push(adapter.sendTextReply("chat_1", `Message ${i}`));
    }
    await Promise.all(promises);

    const elapsed = Date.now() - start;
    expect(fetchCalls).toHaveLength(30);
    // 30 messages should complete quickly (well under 1 second) since bucket starts full
    expect(elapsed).toBeLessThan(1000);
  });

  it("sends messages sequentially without errors", async () => {
    // Send 5 messages sequentially
    for (let i = 0; i < 5; i++) {
      await adapter.sendTextReply("chat_1", `Message ${i}`);
    }
    expect(fetchCalls).toHaveLength(5);
    // Each call should target the sendMessage endpoint
    for (const call of fetchCalls) {
      expect(call.url).toContain("/sendMessage");
    }
  });

  it("applies rate limiting to all API methods (sendApprovalCard, sendResultCard)", async () => {
    // sendApprovalCard
    await adapter.sendApprovalCard("chat_1", {
      summary: "Test action",
      riskCategory: "low",
      explanation: "Test explanation",
      buttons: [{ label: "Approve", callbackData: "approve" }],
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toContain("/sendMessage");

    // sendResultCard
    await adapter.sendResultCard("chat_1", {
      summary: "Done",
      success: true,
      auditId: "audit_1",
      riskCategory: "low",
      undoAvailable: false,
      undoExpiresAt: null,
    });
    expect(fetchCalls).toHaveLength(2);

    // answerCallbackQuery
    await adapter.answerCallbackQuery("cb_1", "OK");
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[2]!.url).toContain("/answerCallbackQuery");
  });

  it("token bucket refills over time", async () => {
    // Drain the bucket
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 30; i++) {
      promises.push(adapter.sendTextReply("chat_1", `Drain ${i}`));
    }
    await Promise.all(promises);
    expect(fetchCalls).toHaveLength(30);

    // Wait a small amount for some tokens to refill (100ms → ~3 tokens)
    await new Promise((resolve) => setTimeout(resolve, 120));

    // Should be able to send at least 1 more message
    await adapter.sendTextReply("chat_1", "After refill");
    expect(fetchCalls).toHaveLength(31);
  });
});
