import { describe, it, expect, vi } from "vitest";
import { PrismaConversationStateStore } from "../prisma-conversation-state-store.js";
import { ConversationStateNotFoundError, type WorkTrace } from "@switchboard/core/platform";

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
