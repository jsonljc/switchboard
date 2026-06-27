import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramAdapter } from "../adapters/telegram.js";
import type { ApprovalCardPayload } from "../adapters/adapter.js";

describe("TelegramAdapter", () => {
  const adapter = new TelegramAdapter("fake-bot-token");

  describe("parseIncomingMessage – message payload", () => {
    const messagePayload = {
      update_id: 123456,
      message: {
        message_id: 42,
        from: { id: 9001, is_bot: false, first_name: "Alice" },
        chat: { id: 5555, type: "private" },
        date: 1700000000,
        text: "pause Summer Sale",
      },
    };

    it("parses a valid Telegram message into an IncomingMessage", () => {
      const msg = adapter.parseIncomingMessage(messagePayload);
      expect(msg).not.toBeNull();
      expect(msg!.id).toBe("tg_42");
      expect(msg!.channel).toBe("telegram");
      expect(msg!.channelMessageId).toBe("42");
      expect(msg!.threadId).toBe("5555");
      expect(msg!.principalId).toBe("9001");
      expect(msg!.text).toBe("pause Summer Sale");
      expect(msg!.attachments).toEqual([]);
      expect(msg!.organizationId).toBeNull();
      expect(msg!.timestamp).toEqual(new Date(1700000000 * 1000));
    });
  });

  describe("parseIncomingMessage – callback_query payload", () => {
    const callbackPayload = {
      update_id: 789012,
      callback_query: {
        id: "cb_99",
        from: { id: 9001, is_bot: false, first_name: "Alice" },
        message: {
          message_id: 50,
          chat: { id: 5555, type: "private" },
          date: 1700000100,
          text: "Approve?",
        },
        data: '{"action":"approve","approvalId":"appr_1"}',
      },
    };

    it("parses a callback_query into an IncomingMessage", () => {
      const msg = adapter.parseIncomingMessage(callbackPayload);
      expect(msg).not.toBeNull();
      expect(msg!.id).toBe("tg_cb_cb_99");
      expect(msg!.channel).toBe("telegram");
      expect(msg!.channelMessageId).toBe("cb_99");
      expect(msg!.threadId).toBe("5555");
      expect(msg!.principalId).toBe("9001");
      expect(msg!.text).toBe('{"action":"approve","approvalId":"appr_1"}');
      expect(msg!.attachments).toEqual([]);
    });
  });

  describe("parseIncomingMessage – invalid payload", () => {
    it("returns null for a payload with no message or callback_query", () => {
      const invalid = { update_id: 111 };
      const msg = adapter.parseIncomingMessage(invalid);
      expect(msg).toBeNull();
    });

    it("returns null for an empty object", () => {
      const msg = adapter.parseIncomingMessage({});
      expect(msg).toBeNull();
    });
  });

  describe("extractMessageId", () => {
    it("extracts message_id from a message payload", () => {
      const payload = {
        message: { message_id: 77, from: { id: 1 }, chat: { id: 2 } },
      };
      const id = adapter.extractMessageId(payload);
      expect(id).toBe("77");
    });

    it("extracts id from a callback_query payload", () => {
      const payload = {
        callback_query: {
          id: "cb_42",
          from: { id: 1 },
          message: { message_id: 10, chat: { id: 2 } },
        },
      };
      const id = adapter.extractMessageId(payload);
      expect(id).toBe("cb_42");
    });

    it("returns null when neither message nor callback_query exist", () => {
      const id = adapter.extractMessageId({ update_id: 999 });
      expect(id).toBeNull();
    });
  });
});

// CHAN-4 / BUG-4: Telegram rejects the whole sendMessage when any inline
// button's callback_data exceeds 64 bytes (UTF-8). A real approval card carries
// `{action, approvalId, bindingHash}` JSON (~150 bytes), so the card would be
// silently dropped. The adapter must never emit an oversized callback_data:
// deliver the card without buttons + a dashboard fallback instead.
describe("TelegramAdapter — sendApprovalCard callback_data cap (CHAN-4)", () => {
  const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentBody(): Record<string, unknown> {
    const init = fetchSpy.mock.calls[0]?.[1];
    return JSON.parse(String(init?.body ?? "{}"));
  }

  function card(buttons: ApprovalCardPayload["buttons"]): ApprovalCardPayload {
    return {
      summary: "Pause campaign ABC",
      riskCategory: "medium",
      explanation: "Budget exceeds limit",
      buttons,
    };
  }

  it("sends inline approve/reject buttons when callback_data fits", async () => {
    const adapter = new TelegramAdapter("fake-bot-token");
    await adapter.sendApprovalCard(
      "5555",
      card([
        {
          label: "Approve",
          callbackData: '{"action":"approve","approvalId":"a","bindingHash":"b"}',
        },
        { label: "Reject", callbackData: '{"action":"reject","approvalId":"a","bindingHash":"b"}' },
      ]),
    );

    const body = sentBody();
    const buttons = (
      body["reply_markup"] as { inline_keyboard: Array<Array<{ callback_data: string }>> }
    ).inline_keyboard.flat();
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(Buffer.byteLength(b.callback_data, "utf8")).toBeLessThanOrEqual(64);
    }
  });

  it("omits the keyboard and falls back to the dashboard when callback_data is oversized", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new TelegramAdapter("fake-bot-token");

    const oversized = JSON.stringify({
      action: "approve",
      approvalId: "appr_550e8400-e29b-41d4-a716-446655440000",
      bindingHash: "a".repeat(64),
    });
    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(64);

    await adapter.sendApprovalCard(
      "5555",
      card([
        { label: "Approve", callbackData: oversized },
        { label: "Reject", callbackData: oversized.replace("approve", "reject") },
      ]),
    );

    const body = sentBody();
    // No inline keyboard (it would make Telegram reject the whole message)...
    expect(body["reply_markup"]).toBeUndefined();
    // ...the card text is still delivered with a dashboard fallback...
    expect(String(body["text"])).toContain("Approve or reject this from the dashboard");
    // ...and the drop is observable.
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
