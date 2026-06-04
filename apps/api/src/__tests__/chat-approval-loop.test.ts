/**
 * Chat-surface twin of recommendation-handoff-approval-loop.test.ts: the SAME
 * guarantee (a human approves exactly one frozen action; the system executes
 * it or exposes recovery) driven through the CHAT entry,
 * handleApprovalResponse, instead of the API route. Two production shapes:
 *
 *  1. legacy+lifecycle coexistence: an ApprovalRequest row AND the lifecycle
 *     row share the work unit id + binding hash; the chat approve must run the
 *     REAL handoff handler through the unified fork (this was the
 *     approve-without-dispatch hole).
 *  2. lifecycle-only fallback: no approval row; the button carries the
 *     lifecycle id; the fallback leg responds, dispatches, and retries.
 *
 * The reply assertions are the operator-honesty contract: the chat reply
 * tracks what actually happened.
 */
import { describe, it, expect } from "vitest";
import {
  handleApprovalResponse,
  respondToParkedLifecycle,
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  REJECT_SUCCESS_MSG,
  createApprovalState,
} from "@switchboard/core";
import type {
  HandleApprovalResponseConfig,
  IdentityStore,
  OperatorChannelBindingStore,
  ReplySink,
} from "@switchboard/core";
import type { ApprovalRequest, Principal } from "@switchboard/schemas";
import { executeWeeklyAudit } from "@switchboard/ad-optimizer";
import { synthesizeCreativeBrief } from "../services/workflows/creative-brief-synthesis.js";
import {
  ORG,
  buildCronDeps,
  buildLifecycleWorld,
  readerFor,
  step,
  type ParkedHandoff,
} from "./recommendation-handoff-harness.js";

const OPERATOR_PRINCIPAL = "principal-op-1";
const CHANNEL = "whatsapp";
const CHANNEL_IDENTIFIER = "+6591234567";

async function parkViaCron(w: ReturnType<typeof buildLifecycleWorld>) {
  const parked: ParkedHandoff[] = [];
  await executeWeeklyAudit(
    step as Parameters<typeof executeWeeklyAudit>[0],
    buildCronDeps(w.harness.ingress, parked),
  );
  expect(parked).toHaveLength(1);
  const res = parked[0]!.res;
  if (!res.ok) throw new Error("submit failed");
  return {
    workUnitId: res.workUnit.id,
    lifecycleId: (res as unknown as { lifecycleId: string }).lifecycleId,
    bindingHash: (res as unknown as { bindingHash: string }).bindingHash,
  };
}

/** Seed the legacy ApprovalRequest row that coexists with the lifecycle row. */
async function seedLegacyApprovalRow(
  w: ReturnType<typeof buildLifecycleWorld>,
  parked: { workUnitId: string; bindingHash: string },
): Promise<string> {
  const approvalId = "appr_chat_1";
  const expiresAt = new Date(Date.now() + 3_600_000);
  const request: ApprovalRequest = {
    id: approvalId,
    actionId: `prop_${parked.workUnitId}`,
    envelopeId: parked.workUnitId,
    conversationId: null,
    summary: "adoptimizer.recommendation.handoff (requested by system)",
    riskCategory: "medium",
    bindingHash: parked.bindingHash,
    evidenceBundle: { decisionTrace: null, contextSnapshot: {}, identitySnapshot: {} },
    suggestedButtons: [
      { label: "Approve", action: "approve" },
      { label: "Reject", action: "reject" },
    ],
    approvers: [OPERATOR_PRINCIPAL],
    fallbackApprover: null,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt,
    expiredBehavior: "deny",
    createdAt: new Date(),
    quorum: null,
  } as unknown as ApprovalRequest;
  await w.storage.approvals.save({
    request,
    state: createApprovalState(expiresAt, null),
    envelopeId: parked.workUnitId,
    organizationId: ORG,
  });
  return approvalId;
}

function chatConfig(w: ReturnType<typeof buildLifecycleWorld>): HandleApprovalResponseConfig {
  const bindingStore: OperatorChannelBindingStore = {
    findActiveBinding: async (q) =>
      q.organizationId === ORG &&
      q.channel === CHANNEL &&
      q.channelIdentifier === CHANNEL_IDENTIFIER
        ? ({ principalId: OPERATOR_PRINCIPAL } as never)
        : null,
  };
  const principal: Principal = {
    id: OPERATOR_PRINCIPAL,
    type: "user",
    name: "Chat Operator",
    organizationId: ORG,
    roles: ["operator"],
  } as Principal;
  const identityStore = {
    getPrincipal: async (id: string) => (id === OPERATOR_PRINCIPAL ? principal : null),
  } as unknown as IdentityStore;
  return {
    bindingStore,
    identityStore,
    respondDeps: {
      approvalStore: w.storage.approvals,
      envelopeStore: w.storage.envelopes,
      workTraceStore: w.harness.traceStore,
      lifecycleService: w.lifecycleService,
      platformLifecycle: w.platformLifecycle,
      sessionManager: null,
      auditLedger: w.ledger,
      logger: { info: () => {}, error: () => {} },
    },
  };
}

function replyCapture(): { sink: ReplySink; replies: string[] } {
  const replies: string[] = [];
  return {
    sink: {
      send: async (text) => {
        replies.push(text);
      },
    },
    replies,
  };
}

async function chatRespond(
  w: ReturnType<typeof buildLifecycleWorld>,
  payload: { action: "approve" | "reject"; approvalId: string; bindingHash: string },
) {
  const { sink, replies } = replyCapture();
  await handleApprovalResponse({
    payload,
    organizationId: ORG,
    channel: CHANNEL,
    channelIdentifier: CHANNEL_IDENTIFIER,
    approvalStore: w.storage.approvals,
    replySink: sink,
    config: chatConfig(w),
  });
  return replies;
}

describe("chat-surface approve drives the REAL lifecycle and the REAL dispatch", () => {
  it("legacy+lifecycle coexistence: chat approve runs the handoff handler and creates the Mira draft", async () => {
    const w = buildLifecycleWorld();
    const parked = await parkViaCron(w);
    const approvalId = await seedLegacyApprovalRow(w, parked);

    const replies = await chatRespond(w, {
      action: "approve",
      approvalId,
      bindingHash: parked.bindingHash,
    });

    // honest reply
    expect(replies).toEqual([APPROVE_EXECUTED_MSG]);
    // THE HANDLER RAN: the real workflow handler created the Mira job
    expect(w.harness.jobs).toHaveLength(1);
    const expectedBrief = synthesizeCreativeBrief(null);
    const rm = await readerFor(w.harness.jobs).read(ORG, { now: new Date(), timezone: "UTC" });
    expect(rm.jobs.find((j) => j.title === expectedBrief.productDescription)).toBeDefined();
    // canonical records
    const trace = (await w.harness.traceStore.getByWorkUnitId(parked.workUnitId))!.trace;
    expect(trace.outcome).toBe("completed");
    expect(trace.approvalOutcome).toBe("approved");
    expect(trace.approvalRespondedBy).toBe(OPERATOR_PRINCIPAL);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "approved",
    );
    const dispatches = w.store.listDispatchRecords();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.state).toBe("succeeded");
  });

  it("dispatch failure: chat reply is honest, the unit parks as a Retry card, retry recovers", async () => {
    const w = buildLifecycleWorld();
    w.harness.breakHandoffHandlerOnce();
    const parked = await parkViaCron(w);
    const approvalId = await seedLegacyApprovalRow(w, parked);

    const replies = await chatRespond(w, {
      action: "approve",
      approvalId,
      bindingHash: parked.bindingHash,
    });
    expect(replies).toEqual([APPROVE_DISPATCH_FAILED_MSG]);
    expect(w.harness.jobs).toHaveLength(0);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "recovery_required",
    );

    // Retry through the canonical Inbox leg (respondToParkedLifecycle is what
    // the route fires) recovers with attempt 2.
    const second = await respondToParkedLifecycle(w.deps, {
      lifecycleId: parked.lifecycleId,
      action: "approve",
      respondedBy: OPERATOR_PRINCIPAL,
      bindingHash: parked.bindingHash,
    });
    expect(second.executionResult?.success).toBe(true);
    expect(w.harness.jobs).toHaveLength(1);
    const records = w.store.listDispatchRecords();
    expect(records).toHaveLength(2);
    expect(records[1]?.attemptNumber).toBe(2);
    expect(records[1]?.state).toBe("succeeded");
  });

  it("lifecycle-only fallback: a button carrying the lifecycle id approves, dispatches, and chat-side retry works", async () => {
    const w = buildLifecycleWorld();
    w.harness.breakHandoffHandlerOnce();
    const parked = await parkViaCron(w);
    // NO legacy approval row: the fallback leg must resolve the lifecycle id.

    const first = await chatRespond(w, {
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(first).toEqual([APPROVE_DISPATCH_FAILED_MSG]);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "recovery_required",
    );

    // chat-side retry: the SAME button tap is approve-on-recovery_required
    const second = await chatRespond(w, {
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(second).toEqual([APPROVE_EXECUTED_MSG]);
    expect(w.harness.jobs).toHaveLength(1);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "approved",
    );
  });

  it("chat reject of the parked handoff creates nothing and fails the trace", async () => {
    const w = buildLifecycleWorld();
    const parked = await parkViaCron(w);

    const replies = await chatRespond(w, {
      action: "reject",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(replies).toEqual([REJECT_SUCCESS_MSG]);
    expect(w.harness.jobs).toHaveLength(0);
    const trace = (await w.harness.traceStore.getByWorkUnitId(parked.workUnitId))!.trace;
    expect(trace.outcome).toBe("failed");
    expect(trace.approvalOutcome).toBe("rejected");
  });
});
