import { describe, expect, it } from "vitest";
import {
  ConversationSummarySchema,
  ConversationDetailSchema,
  ConversationListResultSchema,
  type ConversationSummary,
} from "../conversations.js";

describe("ConversationSummarySchema", () => {
  const valid: ConversationSummary = {
    id: "conv_1",
    threadId: "thread_1",
    channel: "whatsapp",
    principalId: "user_a",
    organizationId: "org_a",
    status: "active",
    currentIntent: null,
    messageCount: 3,
    lastMessage: "Hello",
    firstReplyAt: null,
    lastActivityAt: "2026-05-22T10:00:00.000Z",
  };

  it("parses a valid summary", () => {
    expect(ConversationSummarySchema.safeParse(valid).success).toBe(true);
  });

  it("allows null lastMessage when conversation has zero messages", () => {
    expect(
      ConversationSummarySchema.safeParse({ ...valid, messageCount: 0, lastMessage: null }).success,
    ).toBe(true);
  });
});

describe("ConversationDetailSchema", () => {
  it("parses a valid detail with messages", () => {
    const result = ConversationDetailSchema.safeParse({
      id: "conv_1",
      threadId: "thread_1",
      channel: "whatsapp",
      principalId: "user_a",
      organizationId: null,
      status: "active",
      currentIntent: null,
      firstReplyAt: null,
      lastActivityAt: "2026-05-22T10:00:00.000Z",
      messages: [{ role: "user", text: "hi", timestamp: "2026-05-22T09:59:59.000Z" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("ConversationListResultSchema", () => {
  it("parses an empty list", () => {
    expect(
      ConversationListResultSchema.safeParse({
        conversations: [],
        total: 0,
        limit: 20,
        offset: 0,
      }).success,
    ).toBe(true);
  });
});
