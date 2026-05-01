import { describe, it, expect, vi } from "vitest";
import { PrismaConversationStateStore } from "../prisma-conversation-state-store.js";
import {
  ConversationStateNotFoundError,
  ConversationStateInvalidTransitionError,
  type WorkTrace,
} from "@switchboard/core/platform";

function makeReplyTimeStatsPrisma(rows: Array<{ createdAt: Date; firstReplyAt: Date | null }>) {
  return {
    $transaction: vi.fn(),
    conversationState: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  };
}

// Note: ActorType is "user" | "agent" | "system" | "service". Operator-driven
// mutations use "user" (operators are humans). The id is whatever the API
// request can attribute — see Task 13 for resolveOperatorActor.
const operator = { type: "user" as const, id: "user_op_1" };

function makeStore() {
  const txConvUpdate = vi.fn();
  const txConvFindFirst = vi.fn();
  const txTraceCreate = vi.fn().mockResolvedValue(undefined);
  const tx = {
    conversationState: { findFirst: txConvFindFirst, update: txConvUpdate },
    workTrace: { create: txTraceCreate },
  };
  const prisma = {
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  } as never;
  const recordOperatorMutation = vi.fn(async (_trace: unknown, ctx: { tx: typeof tx }) => {
    await ctx.tx.workTrace.create({ data: {} });
  });
  // Mocks WorkTraceStore.update used for the post-tx finalize step (spec §4.7.1).
  const workTraceStoreUpdate = vi.fn(async (_workUnitId: string, _patch: unknown) => ({
    ok: true as const,
    trace: {} as never,
  }));
  const workTraceStore = { recordOperatorMutation, update: workTraceStoreUpdate } as never;
  const store = new PrismaConversationStateStore(prisma, workTraceStore);
  return {
    store,
    tx,
    txConvFindFirst,
    txConvUpdate,
    recordOperatorMutation,
    workTraceStoreUpdate,
  };
}

describe("PrismaConversationStateStore.setOverride", () => {
  it("flips status to human_override and records an operator-mutation trace", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "conv_1",
      status: "active",
      threadId: "t1",
    });
    harness.txConvUpdate.mockResolvedValueOnce({
      id: "conv_1",
      status: "human_override",
      threadId: "t1",
    });

    const result = await harness.store.setOverride({
      organizationId: "org_1",
      threadId: "t1",
      override: true,
      operator,
    });

    expect(harness.txConvUpdate).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: expect.objectContaining({ status: "human_override" }),
    });
    expect(harness.recordOperatorMutation).toHaveBeenCalledTimes(1);
    const trace = harness.recordOperatorMutation.mock.calls[0]![0] as WorkTrace;
    expect(trace).toMatchObject({
      intent: "conversation.override.set",
      mode: "operator_mutation",
      ingressPath: "store_recorded_operator_mutation",
      hashInputVersion: 2,
      governanceOutcome: "execute",
      riskScore: 0,
      matchedPolicies: [],
      actor: { type: "user", id: "user_op_1" },
      trigger: "api",
      outcome: "running",
      durationMs: 0,
      modeMetrics: expect.objectContaining({ governanceMode: "operator_auto_allow" }),
    });
    expect(trace.executionStartedAt).toBeUndefined();
    expect(trace.completedAt).toBeUndefined();
    expect(trace.parameters).toMatchObject({
      actionKind: "conversation.override.set",
      orgId: "org_1",
      conversationId: "conv_1",
      before: { status: "active" },
      after: { status: "human_override" },
    });
    expect(harness.workTraceStoreUpdate).toHaveBeenCalledTimes(1);
    const [finalizeWorkUnitId, finalizePatch] = harness.workTraceStoreUpdate.mock.calls[0]!;
    expect(finalizeWorkUnitId).toBe(trace.workUnitId);
    expect(finalizePatch).toMatchObject({
      outcome: "completed",
      executionStartedAt: expect.any(String),
      completedAt: expect.any(String),
      durationMs: expect.any(Number),
    });
    expect(result.status).toBe("human_override");
    expect(result.workTraceId).toBe(trace.workUnitId);
  });

  it("flips status to active when override=false", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "conv_1",
      status: "human_override",
      threadId: "t1",
    });
    harness.txConvUpdate.mockResolvedValueOnce({
      id: "conv_1",
      status: "active",
      threadId: "t1",
    });
    const result = await harness.store.setOverride({
      organizationId: "org_1",
      threadId: "t1",
      override: false,
      operator,
    });
    expect(result.status).toBe("active");
  });

  it("throws ConversationStateNotFoundError when no row matches", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce(null);
    await expect(
      harness.store.setOverride({
        organizationId: "org_1",
        threadId: "missing",
        override: true,
        operator,
      }),
    ).rejects.toBeInstanceOf(ConversationStateNotFoundError);
    expect(harness.txConvUpdate).not.toHaveBeenCalled();
    expect(harness.recordOperatorMutation).not.toHaveBeenCalled();
  });
});

describe("PrismaConversationStateStore.sendOperatorMessage", () => {
  it("appends owner message and records send trace", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "conv_1",
      threadId: "t1",
      status: "human_override",
      messages: [{ role: "agent", text: "earlier", timestamp: "2026-04-28T00:00:00.000Z" }],
      channel: "telegram",
      principalId: "p_customer",
    });
    harness.txConvUpdate.mockResolvedValueOnce({
      id: "conv_1",
      threadId: "t1",
      status: "human_override",
      channel: "telegram",
      principalId: "p_customer",
    });

    const result = await harness.store.sendOperatorMessage({
      organizationId: "org_1",
      threadId: "t1",
      operator,
      message: { text: "Hello there, how can I help?" },
    });

    const trace = harness.recordOperatorMutation.mock.calls[0]![0] as WorkTrace;
    expect(trace).toMatchObject({
      intent: "conversation.message.send",
      mode: "operator_mutation",
      ingressPath: "store_recorded_operator_mutation",
    });
    expect(trace.parameters).toMatchObject({
      actionKind: "conversation.message.send",
      message: expect.objectContaining({
        channel: "telegram",
        destination: "p_customer",
        deliveryAttempted: false,
      }),
    });
    expect(typeof (trace.parameters as { message: { bodyHash: string } }).message.bodyHash).toBe(
      "string",
    );
    expect(
      (trace.parameters as { message: { bodyHash: string } }).message.bodyHash.length,
    ).toBeGreaterThan(0);
    expect(
      (trace.parameters as { message: { redactedPreview: string } }).message.redactedPreview,
    ).toBe("Hello there, how can I help?");
    expect(result.appendedMessage.role).toBe("owner");
    expect(result.appendedMessage.text).toBe("Hello there, how can I help?");
    expect(result.channel).toBe("telegram");
    expect(result.destinationPrincipalId).toBe("p_customer");
  });

  it("rejects when conversation is not in human_override", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "c",
      status: "active",
      threadId: "t",
      messages: [],
    });
    await expect(
      harness.store.sendOperatorMessage({
        organizationId: "org_1",
        threadId: "t",
        operator,
        message: { text: "x" },
      }),
    ).rejects.toBeInstanceOf(ConversationStateInvalidTransitionError);
    expect(harness.txConvUpdate).not.toHaveBeenCalled();
  });

  it("404s when conversation is missing", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce(null);
    await expect(
      harness.store.sendOperatorMessage({
        organizationId: "org_1",
        threadId: "missing",
        operator,
        message: { text: "x" },
      }),
    ).rejects.toBeInstanceOf(ConversationStateNotFoundError);
  });
});

describe("PrismaConversationStateStore.releaseEscalationToAi", () => {
  it("flips conversation to active, appends owner reply, records escalation.reply.release_to_ai trace", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "conv_1",
      threadId: "t1",
      status: "human_override",
      messages: [],
      channel: "whatsapp",
      principalId: "p_customer",
    });
    harness.txConvUpdate.mockResolvedValueOnce({
      id: "conv_1",
      threadId: "t1",
      status: "active",
      channel: "whatsapp",
      principalId: "p_customer",
    });

    const result = await harness.store.releaseEscalationToAi({
      organizationId: "org_1",
      handoffId: "h_1",
      threadId: "t1",
      operator,
      reply: { text: "Thanks, taking it from here." },
    });

    expect(harness.txConvUpdate).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: expect.objectContaining({ status: "active" }),
    });
    const trace = harness.recordOperatorMutation.mock.calls[0]![0] as WorkTrace;
    expect(trace).toMatchObject({
      intent: "escalation.reply.release_to_ai",
      mode: "operator_mutation",
      ingressPath: "store_recorded_operator_mutation",
    });
    expect(trace.parameters).toMatchObject({
      actionKind: "escalation.reply.release_to_ai",
      escalationId: "h_1",
      before: { status: "human_override" },
      after: { status: "active" },
    });
    expect(result.channel).toBe("whatsapp");
    expect(result.destinationPrincipalId).toBe("p_customer");
    expect(result.appendedReply.role).toBe("owner");
  });

  it("404s when conversation is missing for the threadId", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce(null);
    await expect(
      harness.store.releaseEscalationToAi({
        organizationId: "org_1",
        handoffId: "h_1",
        threadId: "t_missing",
        operator,
        reply: { text: "x" },
      }),
    ).rejects.toBeInstanceOf(ConversationStateNotFoundError);
  });
});

describe("PrismaConversationStateStore.replyTimeStats", () => {
  it("returns the median latency for today's replied conversations and the sample size", async () => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Row A: 10s latency (today)
    const createdA = new Date(today.getTime() + 9 * 3600_000);
    const replyA = new Date(today.getTime() + 9 * 3600_000 + 10_000);
    // Row B: 30s latency (today)
    const createdB = new Date(today.getTime() + 10 * 3600_000);
    const replyB = new Date(today.getTime() + 10 * 3600_000 + 30_000);
    // Row C: null firstReplyAt — excluded by DB query filter
    // Row D: yesterday's row — excluded by DB query filter
    // (In the mock, we simulate the DB already filtering by day + firstReplyAt != null)

    const prisma = makeReplyTimeStatsPrisma([
      { createdAt: createdA, firstReplyAt: replyA },
      { createdAt: createdB, firstReplyAt: replyB },
    ]);
    const store = new PrismaConversationStateStore(prisma as never, {} as never);
    const stats = await store.replyTimeStats("org-replytime", today);

    expect(stats.sampleSize).toBe(2);
    expect(stats.medianSeconds).toBe(20); // median of [10, 30]
  });

  it("excludes conversations whose firstReplyAt is more than 24h after createdAt (SLA cap)", async () => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const createdZ = new Date(today.getTime() + 1 * 3600_000);
    const replyZ = new Date(today.getTime() + 1 * 3600_000 + 25 * 3600_000); // 25h later

    const prisma = makeReplyTimeStatsPrisma([{ createdAt: createdZ, firstReplyAt: replyZ }]);
    const store = new PrismaConversationStateStore(prisma as never, {} as never);
    const stats = await store.replyTimeStats("org-sla", today);

    expect(stats.sampleSize).toBe(0);
    expect(stats.medianSeconds).toBe(0);
  });

  it("returns sampleSize=0 and medianSeconds=0 when no eligible rows", async () => {
    const prisma = makeReplyTimeStatsPrisma([]);
    const store = new PrismaConversationStateStore(prisma as never, {} as never);
    const stats = await store.replyTimeStats("org-empty", new Date());

    expect(stats.sampleSize).toBe(0);
    expect(stats.medianSeconds).toBe(0);
  });

  it("computes correct median for an odd number of latencies", async () => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // 3 rows: 10s, 20s, 60s → sorted [10, 20, 60] → median = 20
    const base = today.getTime() + 9 * 3600_000;
    const prisma = makeReplyTimeStatsPrisma([
      { createdAt: new Date(base), firstReplyAt: new Date(base + 10_000) },
      { createdAt: new Date(base + 3600_000), firstReplyAt: new Date(base + 3600_000 + 20_000) },
      { createdAt: new Date(base + 7200_000), firstReplyAt: new Date(base + 7200_000 + 60_000) },
    ]);
    const store = new PrismaConversationStateStore(prisma as never, {} as never);
    const stats = await store.replyTimeStats("org-odd", today);

    expect(stats.sampleSize).toBe(3);
    expect(stats.medianSeconds).toBe(20);
  });

  it("passes correct where clause to Prisma (organizationId, createdAt range, firstReplyAt not null)", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const prisma = makeReplyTimeStatsPrisma([]);
    const store = new PrismaConversationStateStore(prisma as never, {} as never);
    await store.replyTimeStats("org-check", today);

    expect(prisma.conversationState.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-check",
        createdAt: { gte: today, lt: tomorrow },
        firstReplyAt: { not: null },
      },
      select: { createdAt: true, firstReplyAt: true },
    });
  });
});
