import { describe, expect, it } from "vitest";
import { ConversationStateSchema } from "../chat.js";

describe("ConversationStateSchema — expanded shape (PR-2)", () => {
  it("parses a fully-populated conversation state", () => {
    const result = ConversationStateSchema.safeParse({
      id: "conv_1",
      threadId: "thread_1",
      channel: "whatsapp",
      principalId: "user_a",
      organizationId: "org_a",
      status: "active",
      currentIntent: null,
      pendingProposalIds: [],
      pendingApprovalIds: [],
      clarificationQuestion: null,
      firstReplyAt: null,
      lastInboundAt: null,
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      crmContactId: null,
      messages: [{ role: "user", text: "hi", timestamp: new Date() }],
      leadProfile: null,
      detectedLanguage: "en",
      machineState: "QUALIFYING",
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults when the 4 expanded fields are absent", () => {
    const result = ConversationStateSchema.safeParse({
      id: "conv_1",
      threadId: "thread_1",
      channel: "whatsapp",
      principalId: "user_a",
      organizationId: null,
      status: "active",
      currentIntent: null,
      pendingProposalIds: [],
      pendingApprovalIds: [],
      clarificationQuestion: null,
      lastActivityAt: new Date(),
      expiresAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.messages).toEqual([]);
      expect(result.data.leadProfile).toBeNull();
      expect(result.data.detectedLanguage).toBeNull();
      expect(result.data.machineState).toBeNull();
    }
  });
});
