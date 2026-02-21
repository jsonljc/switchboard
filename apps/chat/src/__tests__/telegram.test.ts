import { describe, it, expect } from "vitest";
import { TelegramAdapter } from "../adapters/telegram.js";

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
