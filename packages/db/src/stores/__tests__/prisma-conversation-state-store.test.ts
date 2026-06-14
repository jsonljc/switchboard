import { describe, it, expect, vi } from "vitest";
import { PrismaConversationStateStore } from "../prisma-conversation-state-store.js";
import {
  ConversationStateNotFoundError,
  ConversationStateInvalidTransitionError,
  ContactNotFoundError,
  type WorkTrace,
} from "@switchboard/core/platform";

// Note: ActorType is "user" | "agent" | "system" | "service". Operator-driven
// mutations use "user" (operators are humans). The id is whatever the API
// request can attribute — see Task 13 for resolveOperatorActor.
const operator = { type: "user" as const, id: "user_op_1" };

function makeStore() {
  const txConvUpdate = vi.fn();
  const txConvUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const txConvFindFirst = vi.fn();
  const txTraceCreate = vi.fn().mockResolvedValue(undefined);
  // Contact-path reads/writes (escalate-tool release target = { contactId }).
  const txContactFindFirst = vi.fn();
  const txConvMessageCreate = vi
    .fn()
    .mockResolvedValue({ id: "cm_1", createdAt: new Date("2026-04-29T11:00:00Z") });
  const tx = {
    conversationState: {
      findFirst: txConvFindFirst,
      update: txConvUpdate,
      updateMany: txConvUpdateMany,
    },
    contact: { findFirst: txContactFindFirst },
    conversationMessage: { create: txConvMessageCreate },
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
    txConvUpdateMany,
    txContactFindFirst,
    txConvMessageCreate,
    recordOperatorMutation,
    workTraceStoreUpdate,
  };
}

describe("PrismaConversationStateStore.setOverride", () => {
  it("flips status to human_override and records an operator-mutation trace", async () => {
    const harness = makeStore();
    // #643: setOverride now uses updateMany; findFirst supplies the returned row fields.
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "conv_1",
      status: "active",
      threadId: "t1",
      organizationId: "org_1",
      lastActivityAt: new Date("2026-04-01T00:00:00Z"),
    });
    // txConvUpdateMany already defaults to {count:1} in makeStore(); no extra mock needed.

    const result = await harness.store.setOverride({
      organizationId: "org_1",
      threadId: "t1",
      override: true,
      operator,
    });

    // #643: must use updateMany with organizationId in WHERE, not unscoped update
    expect(harness.txConvUpdate).not.toHaveBeenCalled();
    expect(harness.txConvUpdateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", organizationId: "org_1" },
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
      organizationId: "org_1",
      lastActivityAt: new Date("2026-04-01T00:00:00Z"),
    });
    // No txConvUpdate mock needed — setOverride derives result from existing merged with data
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
    expect(harness.txConvUpdateMany).not.toHaveBeenCalled();
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
    const result = await harness.store.sendOperatorMessage({
      organizationId: "org_1",
      threadId: "t1",
      operator,
      message: { text: "Hello there, how can I help?" },
    });

    // #643: the mutating WHERE carries organizationId (tenant-isolation), not id alone.
    expect(harness.txConvUpdateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", organizationId: "org_1" },
      data: expect.any(Object),
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
    expect(harness.txConvUpdateMany).not.toHaveBeenCalled();
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

describe("PrismaConversationStateStore.releaseEscalationToAi — thread target (gateway path)", () => {
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
    const result = await harness.store.releaseEscalationToAi({
      organizationId: "org_1",
      handoffId: "h_1",
      operator,
      reply: { text: "Thanks, taking it from here." },
      target: { threadId: "t1" },
    });

    // Gateway path is unchanged: it looks up the ConversationState by threadId.
    expect(harness.txConvFindFirst).toHaveBeenCalledWith({
      where: { threadId: "t1", organizationId: "org_1" },
    });
    // The contact-path collaborators are never touched on this branch.
    expect(harness.txContactFindFirst).not.toHaveBeenCalled();
    expect(harness.txConvMessageCreate).not.toHaveBeenCalled();
    // #643: the mutating WHERE carries organizationId (tenant-isolation), not id alone.
    expect(harness.txConvUpdateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", organizationId: "org_1" },
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
        operator,
        reply: { text: "x" },
        target: { threadId: "t_missing" },
      }),
    ).rejects.toBeInstanceOf(ConversationStateNotFoundError);
  });
});

describe("PrismaConversationStateStore.releaseEscalationToAi — contact target (escalate-tool path)", () => {
  it("writes an outbound ConversationMessage, best-effort flips the phone-keyed status, audits, and returns contact delivery", async () => {
    const harness = makeStore();
    harness.txContactFindFirst.mockResolvedValueOnce({
      id: "contact_1",
      organizationId: "org_1",
      phoneE164: "+6591234567",
      primaryChannel: "whatsapp",
    });
    // No phone-keyed ConversationState row exists on the escalate-tool path:
    // the best-effort status flip must be a no-op (count:0), not a throw.
    harness.txConvUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await harness.store.releaseEscalationToAi({
      organizationId: "org_1",
      handoffId: "h_1",
      operator,
      reply: { text: "We can fit you in at 3pm tomorrow." },
      target: { contactId: "contact_1" },
    });

    // Contact is read org-scoped.
    expect(harness.txContactFindFirst).toHaveBeenCalledWith({
      where: { id: "contact_1", organizationId: "org_1" },
    });
    // The owner reply lands in ConversationMessage with the REAL columns: the
    // canonical transcript the escalation GET reads.
    expect(harness.txConvMessageCreate).toHaveBeenCalledWith({
      data: {
        contactId: "contact_1",
        orgId: "org_1",
        direction: "outbound",
        content: "We can fit you in at 3pm tomorrow.",
        channel: "whatsapp",
        metadata: { sender: "owner" },
      },
    });
    // Best-effort status flip keyed by the phone (the gateway threadId), org-scoped.
    expect(harness.txConvUpdateMany).toHaveBeenCalledWith({
      where: { threadId: "+6591234567", organizationId: "org_1" },
      data: expect.objectContaining({ status: "active" }),
    });
    // The gateway ConversationState lookup is NOT used on the contact branch.
    expect(harness.txConvFindFirst).not.toHaveBeenCalled();

    const trace = harness.recordOperatorMutation.mock.calls[0]![0] as WorkTrace;
    expect(trace).toMatchObject({
      intent: "escalation.reply.release_to_ai",
      mode: "operator_mutation",
      ingressPath: "store_recorded_operator_mutation",
    });
    expect(trace.parameters).toMatchObject({
      actionKind: "escalation.reply.release_to_ai",
      escalationId: "h_1",
      message: expect.objectContaining({
        channel: "whatsapp",
        destination: "+6591234567",
        deliveryAttempted: false,
      }),
    });

    expect(result.channel).toBe("whatsapp");
    expect(result.destinationPrincipalId).toBe("+6591234567");
    expect(result.appendedReply).toMatchObject({
      role: "owner",
      text: "We can fit you in at 3pm tomorrow.",
    });
    expect(typeof result.workTraceId).toBe("string");
    expect(typeof result.conversationId).toBe("string");
  });

  it("throws ContactNotFoundError (distinct from ConversationStateNotFoundError) when the contact is missing", async () => {
    const harness = makeStore();
    harness.txContactFindFirst.mockResolvedValueOnce(null);
    await expect(
      harness.store.releaseEscalationToAi({
        organizationId: "org_1",
        handoffId: "h_1",
        operator,
        reply: { text: "x" },
        target: { contactId: "contact_missing" },
      }),
    ).rejects.toBeInstanceOf(ContactNotFoundError);
    expect(harness.txConvMessageCreate).not.toHaveBeenCalled();
    expect(harness.recordOperatorMutation).not.toHaveBeenCalled();
  });
});
