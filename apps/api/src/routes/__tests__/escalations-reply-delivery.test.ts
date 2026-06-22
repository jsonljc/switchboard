import { describe, it, expect, vi } from "vitest";
import { ConversationStateNotFoundError, ContactNotFoundError } from "@switchboard/core/platform";
import { WhatsAppWindowClosedError } from "@switchboard/core";
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
  overrides: Partial<{
    handoffFindUnique: unknown;
    handoffUpdateMany: unknown;
    handoffFindFirst: unknown;
    workTraceFindFirst: unknown;
  }> = {},
) {
  const releasedRow = { ...handoff, status: "released", acknowledgedAt: new Date() };
  return {
    handoff: {
      findUnique: overrides.handoffFindUnique ?? vi.fn().mockResolvedValue(handoff),
      updateMany: overrides.handoffUpdateMany ?? vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: overrides.handoffFindFirst ?? vi.fn().mockResolvedValue(releasedRow),
    },
    // The reply route resolves the escalate-tool contact via the WorkTrace
    // lineage (traceId === handoff.sessionId). Default: no row => gateway path
    // (falls back to threadId === sessionId, the historical behavior).
    workTrace: {
      findFirst: overrides.workTraceFindFirst ?? vi.fn().mockResolvedValue(null),
    },
  };
}

function makeWorkTraceStore() {
  return {
    persist: vi.fn(),
    claim: vi.fn().mockResolvedValue({ claimed: true }),
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
  it("escalate-tool path: resolves contactId via WorkTrace, delegates with target:{contactId}, delivers, finalizes", async () => {
    const releaseEscalationToAi = vi.fn().mockResolvedValue(makeReleaseResult());
    const sendProactiveForOrg = vi.fn().mockResolvedValue(undefined);
    const workTraceStore = makeWorkTraceStore();
    // The escalate-tool handoff has a WorkTrace lineage carrying the contactId.
    const workTraceFindFirst = vi.fn().mockResolvedValue({ contactId: "c1" });
    const prisma = makePrisma({ workTraceFindFirst });
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore,
      agentNotifier: { sendProactiveForOrg } as unknown as AgentNotifier,
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
    // The contact lineage is resolved org-scoped, by the handoff sessionId(=traceId).
    expect(workTraceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          traceId: "sess-wa-123",
          organizationId: "org_1",
          contactId: { not: null },
        }),
      }),
    );
    expect(releaseEscalationToAi).toHaveBeenCalledWith({
      organizationId: "org_1",
      handoffId: "esc-1",
      operator: { type: "user", id: "principal_1" },
      reply: { text: "We can fit you in at 3pm tomorrow." },
      target: { contactId: "c1" },
    });
    expect(sendProactiveForOrg).toHaveBeenCalledWith(
      "org_1",
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

  it("gateway path: WorkTrace miss falls back to target:{threadId: sessionId}", async () => {
    const releaseEscalationToAi = vi.fn().mockResolvedValue(makeReleaseResult());
    const sendProactiveForOrg = vi.fn().mockResolvedValue(undefined);
    // Default makePrisma workTraceFindFirst resolves null => gateway-gate handoff
    // (no WorkTrace lineage); the route must fall back to the sessionId threadId.
    const prisma = makePrisma();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore: makeWorkTraceStore(),
      agentNotifier: { sendProactiveForOrg } as unknown as AgentNotifier,
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
    expect(releaseEscalationToAi).toHaveBeenCalledWith({
      organizationId: "org_1",
      handoffId: "esc-1",
      operator: { type: "user", id: "principal_1" },
      reply: { text: "We can fit you in at 3pm tomorrow." },
      target: { threadId: "sess-wa-123" },
    });
  });

  it("returns 502 (not 404) when the store throws ContactNotFoundError", async () => {
    const releaseEscalationToAi = vi.fn().mockRejectedValue(new ContactNotFoundError("c1"));
    const workTraceFindFirst = vi.fn().mockResolvedValue({ contactId: "c1" });
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore: makeWorkTraceStore(),
      agentNotifier: { sendProactiveForOrg: vi.fn() } as unknown as AgentNotifier,
      prisma: makePrisma({ workTraceFindFirst }),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body) as { replySent: boolean };
    expect(body.replySent).toBe(false);
  });

  it("returns 502 and records deliveryResult=failed when channel delivery throws", async () => {
    const releaseEscalationToAi = vi.fn().mockResolvedValue(makeReleaseResult());
    const sendProactiveForOrg = vi.fn().mockRejectedValue(new Error("WhatsApp API 500"));
    const workTraceStore = makeWorkTraceStore();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore,
      agentNotifier: { sendProactiveForOrg } as unknown as AgentNotifier,
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
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      handoffFindUnique: vi.fn().mockResolvedValue(handoffWithoutSession),
      handoffUpdateMany: updateMany,
      handoffFindFirst: vi.fn().mockResolvedValue({
        ...handoffWithoutSession,
        status: "released",
        acknowledgedAt: new Date(),
      }),
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
    expect(updateMany).toHaveBeenCalled();
    expect(res.statusCode).toBe(502);
  });

  it("is idempotent: a re-POST after release short-circuits without re-delivering", async () => {
    // The handoff is already released (its reply was delivered on a prior POST).
    const releaseEscalationToAi = vi.fn();
    const sendProactiveForOrg = vi.fn();
    const updateMany = vi.fn();
    const prisma = makePrisma({
      handoffFindUnique: vi
        .fn()
        .mockResolvedValue({ ...handoff, status: "released", acknowledgedAt: new Date() }),
      handoffUpdateMany: updateMany,
    });
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore: makeWorkTraceStore(),
      agentNotifier: { sendProactiveForOrg } as unknown as AgentNotifier,
      prisma,
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "We can fit you in at 3pm tomorrow." },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { replySent: boolean };
    expect(body.replySent).toBe(true);
    // No second delivery, no second release.
    expect(releaseEscalationToAi).not.toHaveBeenCalled();
    expect(sendProactiveForOrg).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rolls the release back to pending when delivery fails, so the owner can retry", async () => {
    const releaseEscalationToAi = vi.fn().mockResolvedValue(makeReleaseResult());
    const sendProactiveForOrg = vi.fn().mockRejectedValue(new Error("WhatsApp API 500"));
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore: makeWorkTraceStore(),
      agentNotifier: { sendProactiveForOrg } as unknown as AgentNotifier,
      prisma: makePrisma({ handoffUpdateMany: updateMany }),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "test" },
    });

    expect(res.statusCode).toBe(502);
    // The release is rolled back to pending after the delivery failure, so the
    // escalation reopens and a retry is not swallowed by the idempotency guard.
    const datas = updateMany.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(datas).toContainEqual(expect.objectContaining({ status: "released" }));
    expect(datas).toContainEqual(
      expect.objectContaining({ status: "pending", acknowledgedAt: null }),
    );
  });

  it("rolls back the release and returns 502 when the WhatsApp 24h window is closed", async () => {
    // The send fails because the recipient is outside the 24h window with no
    // approved template (ProactiveSender throws WhatsAppWindowClosedError). The
    // route must NOT report success: it rolls the release back to pending and
    // returns an honest 502 so the owner is not told "Handed back" while the
    // customer got silence.
    const releaseEscalationToAi = vi.fn().mockResolvedValue(makeReleaseResult());
    const sendProactiveForOrg = vi.fn().mockRejectedValue(new WhatsAppWindowClosedError("…4567"));
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const workTraceStore = makeWorkTraceStore();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore,
      agentNotifier: { sendProactiveForOrg } as unknown as AgentNotifier,
      prisma: makePrisma({ handoffUpdateMany: updateMany }),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "We can fit you in at 3pm tomorrow." },
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body) as { replySent: boolean };
    expect(body.replySent).toBe(false);
    // The optimistic release is rolled back to pending so the handoff reopens.
    const datas = updateMany.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(datas).toContainEqual(expect.objectContaining({ status: "released" }));
    expect(datas).toContainEqual(
      expect.objectContaining({ status: "pending", acknowledgedAt: null }),
    );
    // The non-delivery is recorded on the work trace (failed, not delivered).
    expect(workTraceStore.update.mock.calls[0]![1]).toMatchObject({
      parameters: {
        message: { deliveryAttempted: true, deliveryResult: expect.stringContaining("window") },
      },
      outcome: "completed",
    });
  });

  it("releases the handoff org-scoped and does not roll back when delivery succeeds", async () => {
    const releaseEscalationToAi = vi.fn().mockResolvedValue(makeReleaseResult());
    const sendProactiveForOrg = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore: makeWorkTraceStore(),
      agentNotifier: { sendProactiveForOrg } as unknown as AgentNotifier,
      prisma: makePrisma({ handoffUpdateMany: updateMany }),
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "We can fit you in at 3pm tomorrow." },
    });

    expect(res.statusCode).toBe(200);
    expect(sendProactiveForOrg).toHaveBeenCalled();
    // Exactly one mutation: the org-scoped release. A successful delivery does
    // not roll back.
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "esc-1", organizationId: "org_1" }),
        data: expect.objectContaining({ status: "released" }),
      }),
    );
  });
});
