import { describe, it, expect, vi } from "vitest";
import { ConversationStateNotFoundError } from "@switchboard/core/platform";
import { buildConversationTestApp } from "./build-conversation-test-app.js";

describe("PATCH /api/conversations/:threadId/override", () => {
  it("delegates to conversationStateStore.setOverride and returns 200 with the new status", async () => {
    const setOverride = vi.fn().mockResolvedValue({
      conversationId: "conv_1",
      threadId: "t1",
      status: "human_override",
      workTraceId: "wt_1",
    });
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride,
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      organizationId: "org_1",
      principalId: "principal_1",
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/t1/override",
      payload: { override: true },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      id: "conv_1",
      threadId: "t1",
      status: "human_override",
    });
    expect(setOverride).toHaveBeenCalledWith({
      organizationId: "org_1",
      threadId: "t1",
      override: true,
      operator: { type: "user", id: "principal_1" },
    });
  });

  it("passes override=false through to the store when body.override is false", async () => {
    const setOverride = vi.fn().mockResolvedValue({
      conversationId: "conv_1",
      threadId: "t1",
      status: "active",
      workTraceId: "wt_1",
    });
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride,
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      organizationId: "org_1",
    });

    await app.inject({
      method: "PATCH",
      url: "/api/conversations/t1/override",
      payload: { override: false },
    });

    expect(setOverride).toHaveBeenCalledWith(expect.objectContaining({ override: false }));
  });

  it("returns 404 when the store throws ConversationStateNotFoundError", async () => {
    const setOverride = vi.fn().mockRejectedValue(new ConversationStateNotFoundError("missing"));
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride,
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/missing/override",
      payload: { override: true },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 503 when conversationStateStore is null", async () => {
    const app = await buildConversationTestApp({
      conversationStateStore: null,
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/t1/override",
      payload: { override: true },
    });

    expect(res.statusCode).toBe(503);
  });

  it("returns 403 when no organizationIdFromAuth", async () => {
    const setOverride = vi.fn();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride,
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/t1/override",
      payload: { override: true },
    });

    expect(res.statusCode).toBe(403);
    expect(setOverride).not.toHaveBeenCalled();
  });
});
