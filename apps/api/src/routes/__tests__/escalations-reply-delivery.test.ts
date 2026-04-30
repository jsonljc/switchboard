import { describe, it, expect, vi } from "vitest";
import { ConversationStateNotFoundError } from "@switchboard/core/platform";
import type { AgentNotifier } from "@switchboard/core";
import { buildConversationTestApp } from "./build-conversation-test-app.js";

const handoff = {
  id: "esc-1",
  sessionId: "sess-wa-123",
  organizationId: "org_1",
  leadId: "lead-1",
  status: "pending",
  reason: "human_requested",
  conversationSummary: {},
  leadSnapshot: {},
  qualificationSnapshot: {},
  slaDeadlineAt: new Date("2026-05-01"),
  acknowledgedAt: null as Date | null,
  resolutionNote: null as string | null,
  resolvedAt: null as Date | null,
  createdAt: new Date("2026-04-29T10:00:00Z"),
  updatedAt: new Date("2026-04-29T10:00:00Z"),
};

function makeReleaseResult(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conv_1",
    threadId: "sess-wa-123",
    channel: "whatsapp",
    destinationPrincipalId: "user-phone-123",
    workTraceId: "wt_esc_1",
    appendedReply: {
      role: "owner" as const,
      text: "We can fit you in at 3pm tomorrow.",
      timestamp: "2026-04-29T11:00:00Z",
    },
    ...overrides,
  };
}

function makePrisma(
  overrides: Partial<{ handoffFindUnique: unknown; handoffUpdate: unknown }> = {},
) {
  return {
    handoff: {
      findUnique: overrides.handoffFindUnique ?? vi.fn().mockResolvedValue(handoff),
      update:
        overrides.handoffUpdate ??
        vi.fn().mockResolvedValue({
          ...handoff,
          status: "released",
          acknowledgedAt: new Date(),
        }),
    },
  };
}

function makeWorkTraceStore() {
  return {
    persist: vi.fn(),
    getByWorkUnitId: vi.fn().mockResolvedValue({
      trace: {
        workUnitId: "wt_esc_1",
        parameters: { message: { text: "We can fit you in at 3pm tomorrow." } },
      },
      integrity: { status: "ok" as const },
    }),
    update: vi.fn().mockResolvedValue({ ok: true, trace: { workUnitId: "wt_esc_1" } }),
    getByIdempotencyKey: vi.fn(),
  };
}

describe("POST /api/escalations/:id/reply", () => {
  it("delegates to releaseEscalationToAi, delivers via channel, then finalizes the WorkTrace", async () => {
    const releaseEscalationToAi = vi.fn().mockResolvedValue(makeReleaseResult());
    const sendProactive = vi.fn().mockResolvedValue(undefined);
    const workTraceStore = makeWorkTraceStore();
    const prisma = makePrisma();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore,
      agentNotifier: { sendProactive } as unknown as AgentNotifier,
      prisma,
      organizationId: "org_1",
      principalId: "principal_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "We can fit you in at 3pm tomorrow." },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { replySent: boolean; escalation: { id: string } };
    expect(body.replySent).toBe(true);
    expect(body.escalation.id).toBe("esc-1");
    expect(releaseEscalationToAi).toHaveBeenCalledWith({
      organizationId: "org_1",
      handoffId: "esc-1",
      threadId: "sess-wa-123",
      operator: { type: "user", id: "principal_1" },
      reply: { text: "We can fit you in at 3pm tomorrow." },
    });
    expect(sendProactive).toHaveBeenCalledWith(
      "user-phone-123",
      "whatsapp",
      "We can fit you in at 3pm tomorrow.",
    );
    expect(workTraceStore.update).toHaveBeenCalledWith(
      "wt_esc_1",
      expect.objectContaining({
        parameters: expect.objectContaining({
          message: expect.objectContaining({
            deliveryAttempted: true,
            deliveryResult: "delivered",
          }),
        }),
        outcome: "completed",
      }),
      expect.objectContaining({ caller: "escalations.reply" }),
    );
  });

  it("returns 502 and records deliveryResult=failed when channel delivery throws", async () => {
    const releaseEscalationToAi = vi.fn().mockResolvedValue(makeReleaseResult());
    const sendProactive = vi.fn().mockRejectedValue(new Error("WhatsApp API 500"));
    const workTraceStore = makeWorkTraceStore();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore,
      agentNotifier: { sendProactive } as unknown as AgentNotifier,
      prisma: makePrisma(),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "test" },
    });

    expect(res.statusCode).toBe(502);
    const updateCall = workTraceStore.update.mock.calls[0];
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toMatchObject({
      parameters: {
        message: { deliveryAttempted: true, deliveryResult: expect.stringContaining("failed") },
      },
      outcome: "completed",
    });
  });

  it("returns 404 when handoff does not exist", async () => {
    const releaseEscalationToAi = vi.fn();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore: makeWorkTraceStore(),
      prisma: makePrisma({ handoffFindUnique: vi.fn().mockResolvedValue(null) }),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/missing/reply",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(404);
    expect(releaseEscalationToAi).not.toHaveBeenCalled();
  });

  it("returns 404 when the store throws ConversationStateNotFoundError", async () => {
    const releaseEscalationToAi = vi
      .fn()
      .mockRejectedValue(new ConversationStateNotFoundError("sess-wa-123"));
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore: makeWorkTraceStore(),
      prisma: makePrisma(),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("skips the store call when handoff has no sessionId (still releases handoff)", async () => {
    const releaseEscalationToAi = vi.fn();
    const handoffWithoutSession = { ...handoff, sessionId: null };
    const handoffUpdate = vi.fn().mockResolvedValue({
      ...handoffWithoutSession,
      status: "released",
      acknowledgedAt: new Date(),
    });
    const prisma = makePrisma({
      handoffFindUnique: vi.fn().mockResolvedValue(handoffWithoutSession),
      handoffUpdate,
    });
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore: makeWorkTraceStore(),
      prisma,
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "hi" },
    });

    // No session means no conversation to release; channel delivery is also
    // skipped, so the route returns 502 (consistent with the prior "no
    // delivery happened" semantics).
    expect(releaseEscalationToAi).not.toHaveBeenCalled();
    expect(handoffUpdate).toHaveBeenCalled();
    expect(res.statusCode).toBe(502);
  });
});
