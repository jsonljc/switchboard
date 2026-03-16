import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramAdapter } from "../adapters/telegram.js";

describe("TelegramRateLimiter (via TelegramAdapter)", () => {
  let adapter: TelegramAdapter;
  let fetchCalls: Array<{ url: string; body: unknown }>;

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("allows a burst of 30 messages without delay", async () => {
    // sendTextReply now sends sendChatAction (typing) + delay + sendMessage = 2 fetch calls per message
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 15; i++) {
      promises.push(adapter.sendTextReply("chat_1", `Message ${i}`));
    }
    // Advance past typing delays
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(promises);

    // 15 messages × 2 calls (sendChatAction + sendMessage) = 30 fetch calls
    expect(fetchCalls).toHaveLength(30);
  });

  it("sends messages sequentially without errors", async () => {
    // Send 5 messages sequentially
    for (let i = 0; i < 5; i++) {
      const p = adapter.sendTextReply("chat_1", `Message ${i}`);
      await vi.advanceTimersByTimeAsync(5000);
      await p;
    }
    // 5 messages × 2 calls (sendChatAction + sendMessage)
    expect(fetchCalls).toHaveLength(10);
    // Filter to only sendMessage calls
    const sendMessageCalls = fetchCalls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendMessageCalls).toHaveLength(5);
  });

  it("applies rate limiting to all API methods (sendApprovalCard, sendResultCard)", async () => {
    // sendApprovalCard — no typing delay
    await adapter.sendApprovalCard("chat_1", {
      summary: "Test action",
      riskCategory: "low",
      explanation: "Test explanation",
      buttons: [{ label: "Approve", callbackData: "approve" }],
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toContain("/sendMessage");

    // sendResultCard — no typing delay
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
    // Drain the bucket with sendApprovalCard (no typing delay, 1 call each)
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 30; i++) {
      promises.push(
        adapter.sendApprovalCard("chat_1", {
          summary: `Action ${i}`,
          riskCategory: "low",
          explanation: "Test",
          buttons: [{ label: "OK", callbackData: "ok" }],
        }),
      );
    }
    await Promise.all(promises);
    expect(fetchCalls).toHaveLength(30);

    // Wait a small amount for some tokens to refill (100ms → ~3 tokens)
    await vi.advanceTimersByTimeAsync(120);

    // Should be able to send at least 1 more message
    await adapter.sendApprovalCard("chat_1", {
      summary: "After refill",
      riskCategory: "low",
      explanation: "Test",
      buttons: [{ label: "OK", callbackData: "ok" }],
    });
    expect(fetchCalls).toHaveLength(31);
  });
});
