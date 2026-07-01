// ---------------------------------------------------------------------------
// Unified lifecycle fork: approve/patch drive the SAME frozen-payload ->
// dispatch -> recovery chain as respondToParkedLifecycle (chat-approval-seam
// spec sections 2.2/2.3). Also pins the four-eyes guard (absorbed from
// respond-to-approval-self-approval.test.ts, A2: the production path goes
// respondToApproval -> respondViaLifecycle -> approveLifecycle, which
// historically performed NO self-approval check) and the quorum no-bypass fix.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { ApprovalLifecycleService } from "../lifecycle-service.js";
import { InMemoryLifecycleStore } from "../in-memory-lifecycle-store.js";
import {
  respondToApproval,
  type RespondToApprovalDeps,
  type ApprovalRecordForResponse,
} from "../respond-to-approval.js";
import type { WorkTrace } from "../../platform/work-trace.js";
import type { ExecuteResult } from "@switchboard/schemas";

const ORG = "org-1";
const WORK_UNIT_ID = "env-1";

function makeTrace(originatorId: string, parameters: Record<string, unknown>): WorkTrace {
  return {
    workUnitId: WORK_UNIT_ID,
    requestedAt: new Date().toISOString(),
    organizationId: ORG,
    actor: { id: originatorId, type: "user" },
    intent: "test.action",
    parameters,
    deploymentContext: {
      deploymentId: "dep-1",
      skillSlug: "s",
      trustLevel: "supervised",
      trustScore: 0,
    },
    mode: "skill",
    traceId: "trace-1",
    trigger: "api",
    governanceConstraints: {},
  } as unknown as WorkTrace;
}

function okResult(): ExecuteResult {
  return {
    success: true,
    summary: "handler ran",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 1,
    undoRecipe: null,
  };
}

function failedResult(): ExecuteResult {
  return { ...okResult(), success: false, summary: "handler failed" };
}

async function makeWorld(opts?: {
  originatorId?: string;
  traceParameters?: Record<string, unknown>;
  quorum?: { required: number };
  executeApproved?: ReturnType<typeof vi.fn>;
  selfApprovalAllowed?: boolean;
  withAuditLedger?: boolean;
}) {
  const originatorId = opts?.originatorId ?? "user-orig";
  const traceParameters = opts?.traceParameters ?? { campaignId: "camp-1" };

  const store = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store });
  const { lifecycle, revision } = await lifecycleService.createGatedLifecycle({
    actionEnvelopeId: WORK_UNIT_ID,
    organizationId: ORG,
    expiresAt: new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: traceParameters,
      approvalScopeSnapshot: {},
      bindingHash: "hash-rev-1",
      createdBy: originatorId,
    },
  });

  let trace = makeTrace(originatorId, traceParameters);
  const traceUpdates: Array<Record<string, unknown>> = [];
  const workTraceStore = {
    getByWorkUnitId: vi.fn(async (id: string) =>
      id === WORK_UNIT_ID ? { trace, integrity: { status: "ok" } } : null,
    ),
    update: vi.fn(async (_id: string, fields: Partial<WorkTrace>) => {
      trace = { ...trace, ...fields } as WorkTrace;
      traceUpdates.push(fields as Record<string, unknown>);
      return { ok: true, trace };
    }),
  };

  let envelope: { id: string; status: string } | null = {
    id: WORK_UNIT_ID,
    status: "pending_approval",
  };
  const envelopeStore = {
    getById: vi.fn(async () => envelope),
    update: vi.fn(async (_id: string, fields: { status?: string }) => {
      if (envelope) envelope = { ...envelope, ...fields };
      return envelope;
    }),
    save: vi.fn(),
  };

  const approvalUpdates: Array<{ status: string; version: number }> = [];
  const persistedStates: Array<Record<string, unknown>> = [];
  const approvalStore = {
    save: vi.fn(),
    getById: vi.fn(),
    updateState: vi.fn(async (_id: string, newState: { status: string; version: number }) => {
      approvalUpdates.push({ status: newState.status, version: newState.version });
      persistedStates.push(newState as unknown as Record<string, unknown>);
    }),
    listPending: vi.fn(),
  };

  const executeApproved = opts?.executeApproved ?? vi.fn(async () => okResult());
  const ledgerEvents: Array<{ eventType: string }> = [];
  const auditLedger = opts?.withAuditLedger
    ? ({
        record: vi.fn(async (e: { eventType: string }) => {
          ledgerEvents.push(e);
        }),
      } as never)
    : undefined;

  const deps = {
    approvalStore,
    envelopeStore,
    workTraceStore,
    lifecycleService,
    platformLifecycle: { respondToApproval: vi.fn(), executeApproved },
    sessionManager: null,
    logger: { info: vi.fn(), error: vi.fn() },
    selfApprovalAllowed: opts?.selfApprovalAllowed,
    auditLedger,
  } as unknown as RespondToApprovalDeps;

  const approval: ApprovalRecordForResponse = {
    request: {
      id: "appr-1",
      actionId: "act-1",
      createdAt: new Date(),
      bindingHash: revision.bindingHash,
    } as never,
    state: {
      status: "pending",
      version: 0,
      expiresAt: new Date(Date.now() + 3_600_000),
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      quorum: opts?.quorum ? { required: opts.quorum.required, approvalHashes: [] } : null,
    } as never,
    envelopeId: WORK_UNIT_ID,
    organizationId: ORG,
  };

  return {
    deps,
    approval,
    lifecycle,
    revision,
    lifecycleService,
    store,
    executeApproved,
    workTraceStore,
    approvalStore,
    approvalUpdates,
    persistedStates,
    traceUpdates,
    envelopeStore,
    getEnvelope: () => envelope,
    getTrace: () => trace,
    ledgerEvents,
  };
}

function approveParams(bindingHash: string) {
  return {
    approvalId: "appr-1",
    action: "approve" as const,
    respondedBy: "operator-jane",
    bindingHash,
  };
}

describe("respondToApproval lifecycle fork: unified dispatch chain", () => {
  it("approve drives approveLifecycle -> frozen payload -> envelope approved -> dispatch -> ExecuteResult", async () => {
    const w = await makeWorld();
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );

    // THE HANDLER RAN (the invariant), with the original work unit id
    expect(w.executeApproved).toHaveBeenCalledWith(WORK_UNIT_ID);
    // executionResult is the real ExecuteResult, not { executableWorkUnitId }
    expect(result.executionResult).toMatchObject({ success: true, summary: "handler ran" });
    // lifecycle approved
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("approved");
    // frozen payload + approval fields written onto the trace BEFORE dispatch
    expect(w.getTrace().approvalOutcome).toBe("approved");
    expect(w.getTrace().approvalRespondedBy).toBe("operator-jane");
    // A7 rank5: approvalId stamped from the approved lifecycle (proof-chain humanApprovalId link).
    expect(w.getTrace().approvalId).toBe(w.lifecycle.id);
    // envelope flipped to approved (executeAfterApproval admission gate)
    expect(w.getEnvelope()?.status).toBe("approved");
    // legacy row synced as a side record
    expect(w.approvalUpdates).toEqual([{ status: "approved", version: 1 }]);
    // durable dispatch record, attempt 1, succeeded, deterministic key
    const records = w.store.listDispatchRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ attemptNumber: 1, state: "succeeded" });
    expect(records[0]?.idempotencyKey).toBe(
      `lifecycle-dispatch:${w.lifecycle.id}:${w.revision.id}:attempt-1`,
    );
  });

  it("payload authority: dispatch happens from the APPROVED revision snapshot, not stale trace params", async () => {
    const w = await makeWorld({ traceParameters: { campaignId: "approved" } });
    // Sabotage: the trace drifts AFTER the revision snapshot was taken
    (w.getTrace() as { parameters: Record<string, unknown> }).parameters = {
      campaignId: "old",
    };
    await respondToApproval(w.deps, approveParams(w.revision.bindingHash), w.approval);
    // The frozen payload (revision snapshot) was committed onto the trace pre-dispatch
    expect(w.getTrace().parameters).toEqual({ campaignId: "approved" });
    const payloadWrite = w.traceUpdates.find((u) => "parameters" in u);
    expect(payloadWrite?.["parameters"]).toEqual({ campaignId: "approved" });
  });

  it("dispatch returning success:false transitions the lifecycle to recovery_required", async () => {
    const w = await makeWorld({ executeApproved: vi.fn(async () => failedResult()) });
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toMatchObject({ success: false });
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe(
      "recovery_required",
    );
    expect(w.store.listDispatchRecords()[0]?.state).toBe("failed");
  });

  it("dispatch THROW records a failed dispatch, transitions to recovery_required, and rethrows", async () => {
    const w = await makeWorld({
      executeApproved: vi.fn(async () => {
        throw new Error("mode handler exploded");
      }),
    });
    await expect(
      respondToApproval(w.deps, approveParams(w.revision.bindingHash), w.approval),
    ).rejects.toThrow(/mode handler exploded/);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe(
      "recovery_required",
    );
    expect(w.store.listDispatchRecords()[0]?.state).toBe("failed");
  });

  it("payload-commit failure -> recovery_required + action.failed audit, never stranded in approved (P2-16)", async () => {
    const w = await makeWorld({ withAuditLedger: true });
    // The pre-dispatch payload write to the trace is REJECTED (integrity-locked
    // trace). approveLifecycle has already moved the lifecycle to "approved"; the
    // failure must NOT strand it there with no dispatch and no recovery. It must
    // compensate to recovery_required, audit action.failed, and rethrow.
    (w.workTraceStore.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      reason: "trace integrity locked",
    });

    await expect(
      respondToApproval(w.deps, approveParams(w.revision.bindingHash), w.approval),
    ).rejects.toThrow(/worktrace update rejected/i);

    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe(
      "recovery_required",
    );
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect(w.store.listDispatchRecords()).toHaveLength(0);
    // Operator-visible failure record; the terminal action.approved is never reached.
    expect(w.ledgerEvents.map((e) => e.eventType)).toContain("action.failed");
    expect(w.ledgerEvents.map((e) => e.eventType)).not.toContain("action.approved");
  });

  it("quorum 1-of-2 approve records a partial approval and does NOT touch the lifecycle", async () => {
    const w = await makeWorld({ quorum: { required: 2 } });
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toBeNull();
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("pending");
    expect(w.approvalUpdates).toHaveLength(1);
    expect(w.store.listDispatchRecords()).toHaveLength(0);
    // The partial approval is attributable: approver + binding hash recorded
    const quorum = w.persistedStates[0]?.["quorum"] as {
      approvalHashes: Array<{ approverId: string; hash: string }>;
    };
    expect(quorum.approvalHashes).toEqual([
      expect.objectContaining({ approverId: "operator-jane", hash: w.revision.bindingHash }),
    ]);
  });

  it("a stale binding hash refuses the approve and mutates nothing", async () => {
    const w = await makeWorld();
    await expect(
      respondToApproval(w.deps, approveParams("hash-stale"), w.approval),
    ).rejects.toThrow(/stale binding/i);
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("pending");
    expect(w.approvalUpdates).toHaveLength(0);
    expect(w.getEnvelope()?.status).toBe("pending_approval");
  });

  it("legacy-row sync failure after the authority commit does NOT prevent dispatch", async () => {
    const w = await makeWorld();
    (w.approvalStore.updateState as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("legacy row version race"),
    );
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toMatchObject({ success: true });
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
  });

  it("envelope approve-flip failure after the authority commit does NOT prevent dispatch (review #1)", async () => {
    const w = await makeWorld();
    (w.envelopeStore.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("envelope updateMany matched 0 rows"),
    );
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    // The dispatch leg owns the failure semantics from here: a real
    // executeAfterApproval would refuse the un-flipped envelope and the
    // engine would transition to recovery_required. What must NEVER happen
    // is an abort between approveLifecycle and the dispatch attempt.
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
    expect(result.executionResult).toMatchObject({ success: true });
    expect(w.store.listDispatchRecords()).toHaveLength(1);
  });

  it("patch creates a new revision and dispatches the PATCHED payload (payload authority on the patch path)", async () => {
    const w = await makeWorld({ traceParameters: { campaignId: "old", budget: 5 } });
    const result = await respondToApproval(
      w.deps,
      {
        approvalId: "appr-1",
        action: "patch",
        respondedBy: "operator-jane",
        bindingHash: w.revision.bindingHash,
        patchValue: { campaignId: "patched" },
      },
      w.approval,
    );
    // dispatched, and the dispatched payload is the patched one
    expect(w.executeApproved).toHaveBeenCalledWith(WORK_UNIT_ID);
    expect(result.executionResult).toMatchObject({ success: true });
    expect(w.getTrace().parameters).toEqual({ campaignId: "patched", budget: 5 });
    expect(w.getTrace().approvalOutcome).toBe("patched");
    // a second revision exists and is the dispatch authority
    const current = await w.lifecycleService.getCurrentRevision(w.lifecycle.id);
    expect(current?.parametersSnapshot).toEqual({ campaignId: "patched", budget: 5 });
    expect(current?.id).not.toBe(w.revision.id);
    // approvalState carries the NEW binding hash (client parity with the old fork)
    expect((result.approvalState as { bindingHash?: string }).bindingHash).toBe(
      current?.bindingHash,
    );
    // legacy row recorded the terminal patch response
    expect(w.approvalUpdates).toEqual([{ status: "patched", version: 1 }]);
  });

  it("a patch with a stale source binding hash dies at createRevision and mutates nothing", async () => {
    const w = await makeWorld();
    await expect(
      respondToApproval(
        w.deps,
        {
          approvalId: "appr-1",
          action: "patch",
          respondedBy: "operator-jane",
          bindingHash: "hash-stale",
          patchValue: { campaignId: "patched" },
        },
        w.approval,
      ),
    ).rejects.toThrow(/stale binding/i);
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("pending");
  });

  it("reject drives rejectLifecycle and the envelope to denied, no dispatch", async () => {
    const w = await makeWorld();
    const result = await respondToApproval(
      w.deps,
      {
        approvalId: "appr-1",
        action: "reject",
        respondedBy: "operator-jane",
        bindingHash: w.revision.bindingHash,
      },
      w.approval,
    );
    expect(result.executionResult).toBeNull();
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("rejected");
    expect(w.getEnvelope()?.status).toBe("denied");
  });

  it("records action.approved in the audit ledger when one is provided", async () => {
    const w = await makeWorld({ withAuditLedger: true });
    await respondToApproval(w.deps, approveParams(w.revision.bindingHash), w.approval);
    expect(w.ledgerEvents.map((e) => e.eventType)).toContain("action.approved");
  });

  // --- four-eyes (absorbed from respond-to-approval-self-approval.test.ts) ---

  it("rejects self-approval (responder === action originator) without mutating or executing", async () => {
    const w = await makeWorld({ originatorId: "operator-jane" });
    await expect(
      respondToApproval(w.deps, approveParams(w.revision.bindingHash), w.approval),
    ).rejects.toThrow(/self-approval/i);
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect(w.approvalUpdates).toHaveLength(0);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("pending");
  });

  it("allows a different principal to approve (no false block)", async () => {
    const w = await makeWorld({ originatorId: "user-orig" });
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toMatchObject({ success: true });
  });

  it("honors the selfApprovalAllowed escape hatch", async () => {
    const w = await makeWorld({ originatorId: "operator-jane", selfApprovalAllowed: true });
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toMatchObject({ success: true });
  });
});
