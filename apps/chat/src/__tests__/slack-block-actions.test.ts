import { describe, it, expect } from "vitest";
import { SlackAdapter } from "../adapters/slack.js";

describe("SlackAdapter – block_actions", () => {
  const adapter = new SlackAdapter("fake-bot-token");

  describe("parseIncomingMessage", () => {
    it("parses a block_actions payload into an IncomingMessage", () => {
      const blockActionsPayload = {
        type: "block_actions",
        user: { id: "U12345", username: "alice" },
        channel: { id: "C67890", name: "general" },
        team: { id: "T11111" },
        actions: [
          {
            action_id: "approval_approve",
            value: "approve:env_abc123",
            type: "button",
          },
        ],
        trigger_id: "trigger_123",
      };

      const msg = adapter.parseIncomingMessage(blockActionsPayload);
      expect(msg).not.toBeNull();
      expect(msg!.id).toBe("slack_action_approval_approve");
      expect(msg!.channel).toBe("slack");
      expect(msg!.channelMessageId).toBe("approval_approve");
      expect(msg!.threadId).toBe("C67890");
      expect(msg!.principalId).toBe("U12345");
      expect(msg!.organizationId).toBe("T11111");
      expect(msg!.text).toBe("approve:env_abc123");
      expect(msg!.attachments).toEqual([]);
      expect(msg!.timestamp).toBeInstanceOf(Date);
    });

    it("returns null for block_actions with empty actions array", () => {
      const emptyActionsPayload = {
        type: "block_actions",
        user: { id: "U12345" },
        channel: { id: "C67890" },
        actions: [],
      };

      const msg = adapter.parseIncomingMessage(emptyActionsPayload);
      expect(msg).toBeNull();
    });

    it("returns null for block_actions missing user", () => {
      const noUserPayload = {
        type: "block_actions",
        channel: { id: "C67890" },
        actions: [{ action_id: "test", value: "val" }],
      };

      const msg = adapter.parseIncomingMessage(noUserPayload);
      expect(msg).toBeNull();
    });

    it("returns null for block_actions missing channel", () => {
      const noChannelPayload = {
        type: "block_actions",
        user: { id: "U12345" },
        actions: [{ action_id: "test", value: "val" }],
      };

      const msg = adapter.parseIncomingMessage(noChannelPayload);
      expect(msg).toBeNull();
    });
  });

  describe("extractMessageId", () => {
    it("returns action_id for block_actions payload", () => {
      const payload = {
        type: "block_actions",
        actions: [{ action_id: "approval_approve" }],
      };

      const id = adapter.extractMessageId(payload);
      expect(id).toBe("approval_approve");
    });

    it("returns null for block_actions with empty actions", () => {
      const payload = {
        type: "block_actions",
        actions: [],
      };

      const id = adapter.extractMessageId(payload);
      expect(id).toBeNull();
    });
  });

  describe("backward compatibility", () => {
    it("still parses regular event messages correctly", () => {
      const eventPayload = {
        team_id: "T11111",
        event: {
          type: "message",
          client_msg_id: "msg_abc",
          ts: "1700000000.000001",
          channel: "C67890",
          user: "U12345",
          text: "hello world",
        },
      };

      const msg = adapter.parseIncomingMessage(eventPayload);
      expect(msg).not.toBeNull();
      expect(msg!.id).toBe("slack_msg_abc");
      expect(msg!.channel).toBe("slack");
      expect(msg!.threadId).toBe("C67890");
      expect(msg!.principalId).toBe("U12345");
      expect(msg!.text).toBe("hello world");
    });

    it("extractMessageId still works for event payloads", () => {
      const eventPayload = {
        event: {
          client_msg_id: "msg_abc",
          ts: "1700000000.000001",
        },
      };

      const id = adapter.extractMessageId(eventPayload);
      expect(id).toBe("msg_abc");
    });
  });
});
