import { describe, it, expect, vi } from "vitest";
import {
  ConversationStateNotFoundError,
  ConversationStateInvalidTransitionError,
} from "@switchboard/core/platform";
import type { AgentNotifier } from "@switchboard/core";
import { buildConversationTestApp } from "./build-conversation-test-app.js";

function makeStoreResult(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conv_1",
    threadId: "t1",
    channel: "telegram",
    destinationPrincipalId: "p1",
    workTraceId: "wt_1",
    appendedMessage: {
      role: "owner" as const,
      text: "hi",
      timestamp: "2026-04-29T00:00:00.000Z",
    },
    ...overrides,
  };
}

function makeWorkTraceStore(
  updateImpl: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    ok: true,
    trace: { workUnitId: "wt_1" },
  }),
) {
  return {
    persist: vi.fn(),
    getByWorkUnitId: vi.fn().mockResolvedValue({
      trace: {
        workUnitId: "wt_1",
        parameters: { message: { text: "hi" } },
      },
      integrity: { status: "ok" as const },
    }),
    update: updateImpl,
    getByIdempotencyKey: vi.fn(),
  };
}

describe("POST /api/conversations/:threadId/send", () => {
  it("delegates to store.sendOperatorMessage, then enriches WorkTrace with delivery outcome", async () => {
    const sendOperatorMessage = vi.fn().mockResolvedValue(makeStoreResult());
    const sendProactive = vi.fn().mockResolvedValue(undefined);
    const workTraceStore = makeWorkTraceStore();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        sendOperatorMessage,
        setOverride: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      workTraceStore,
      agentNotifier: { sendProactive } as unknown as AgentNotifier,
      organizationId: "org_1",
      principalId: "principal_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/t1/send",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ sent: true, threadId: "t1" });
    expect(sendOperatorMessage).toHaveBeenCalledWith({
      organizationId: "org_1",
      threadId: "t1",
      operator: { type: "user", id: "principal_1" },
      message: { text: "hi" },
    });
    expect(sendProactive).toHaveBeenCalledWith("p1", "telegram", "hi");
    expect(workTraceStore.update).toHaveBeenCalledWith(
      "wt_1",
      expect.objectContaining({
        parameters: expect.objectContaining({
          message: expect.objectContaining({
            deliveryAttempted: true,
            deliveryResult: "delivered",
          }),
        }),
        outcome: "completed",
        executionStartedAt: expect.any(String),
        completedAt: expect.any(String),
        durationMs: expect.any(Number),
      }),
      expect.objectContaining({ caller: "conversations.send" }),
    );
  });

  it("returns 502 and records deliveryResult=failed when channel delivery throws", async () => {
    const sendOperatorMessage = vi.fn().mockResolvedValue(makeStoreResult());
    const sendProactive = vi.fn().mockRejectedValue(new Error("Telegram API 500"));
    const workTraceStore = makeWorkTraceStore();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        sendOperatorMessage,
        setOverride: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      workTraceStore,
      agentNotifier: { sendProactive } as unknown as AgentNotifier,
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/t1/send",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(502);
    const updateCall = workTraceStore.update.mock.calls[0];
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toMatchObject({
      parameters: {
        message: {
          deliveryAttempted: true,
          deliveryResult: expect.stringContaining("failed"),
        },
      },
      outcome: "completed",
    });
  });

  it("returns 502 and records deliveryResult=no_notifier when agentNotifier is null", async () => {
    const sendOperatorMessage = vi.fn().mockResolvedValue(makeStoreResult());
    const workTraceStore = makeWorkTraceStore();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        sendOperatorMessage,
        setOverride: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      workTraceStore,
      agentNotifier: null,
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/t1/send",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(502);
    expect(workTraceStore.update).toHaveBeenCalledWith(
      "wt_1",
      expect.objectContaining({
        parameters: expect.objectContaining({
          message: expect.objectContaining({
            deliveryAttempted: false,
            deliveryResult: "no_notifier",
          }),
        }),
        outcome: "completed",
      }),
      expect.any(Object),
    );
  });

  it("returns 404 when store throws ConversationStateNotFoundError", async () => {
    const sendOperatorMessage = vi
      .fn()
      .mockRejectedValue(new ConversationStateNotFoundError("missing"));
    const app = await buildConversationTestApp({
      conversationStateStore: {
        sendOperatorMessage,
        setOverride: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      workTraceStore: makeWorkTraceStore(),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/missing/send",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when store throws ConversationStateInvalidTransitionError", async () => {
    const sendOperatorMessage = vi
      .fn()
      .mockRejectedValue(new ConversationStateInvalidTransitionError("not in human_override"));
    const app = await buildConversationTestApp({
      conversationStateStore: {
        sendOperatorMessage,
        setOverride: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      workTraceStore: makeWorkTraceStore(),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/t1/send",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("returns 503 when conversationStateStore is null", async () => {
    const app = await buildConversationTestApp({
      conversationStateStore: null,
      workTraceStore: makeWorkTraceStore(),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/t1/send",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(503);
  });
});
