import { describe, it, expect } from "vitest";
import type {
  ConversationStateStore,
  ConversationOperatorActionKind,
  SetOverrideInput,
  SetOverrideResult,
  SendOperatorMessageInput,
  SendOperatorMessageResult,
  ReleaseEscalationInput,
  ReleaseEscalationResult,
  ReleaseEscalationTarget,
} from "../conversation-state-store.js";

describe("ConversationStateStore type surface", () => {
  it("exports the three action kinds", () => {
    const kinds: ConversationOperatorActionKind[] = [
      "conversation.override.set",
      "conversation.message.send",
      "escalation.reply.release_to_ai",
    ];
    expect(kinds).toHaveLength(3);
  });

  it("models the release-escalation target as a discriminated union", () => {
    const contactTarget: ReleaseEscalationTarget = { contactId: "c1" };
    const threadTarget: ReleaseEscalationTarget = { threadId: "t1" };
    const contactInput: ReleaseEscalationInput = {
      organizationId: "org_1",
      handoffId: "h_1",
      operator: { type: "user", id: "user_op_1" },
      reply: { text: "hi" },
      target: contactTarget,
    };
    const threadInput: ReleaseEscalationInput = {
      organizationId: "org_1",
      handoffId: "h_1",
      operator: { type: "user", id: "user_op_1" },
      reply: { text: "hi" },
      target: threadTarget,
    };
    expect("contactId" in contactInput.target).toBe(true);
    expect("threadId" in threadInput.target).toBe(true);
  });

  it("has the three method signatures", () => {
    const stub: ConversationStateStore = {
      setOverride: async (_i: SetOverrideInput): Promise<SetOverrideResult> => ({
        conversationId: "c",
        threadId: "t",
        status: "active",
        workTraceId: "w",
      }),
      sendOperatorMessage: async (
        _i: SendOperatorMessageInput,
      ): Promise<SendOperatorMessageResult> => ({
        conversationId: "c",
        threadId: "t",
        channel: "telegram",
        destinationPrincipalId: "p",
        workTraceId: "w",
        appendedMessage: { role: "owner", text: "hi", timestamp: "2026-04-29T00:00:00.000Z" },
      }),
      releaseEscalationToAi: async (
        _i: ReleaseEscalationInput,
      ): Promise<ReleaseEscalationResult> => ({
        conversationId: "c",
        threadId: "t",
        channel: "telegram",
        destinationPrincipalId: "p",
        workTraceId: "w",
        appendedReply: { role: "owner", text: "hi", timestamp: "2026-04-29T00:00:00.000Z" },
      }),
    };
    expect(typeof stub.setOverride).toBe("function");
    expect(typeof stub.sendOperatorMessage).toBe("function");
    expect(typeof stub.releaseEscalationToAi).toBe("function");
  });
});
