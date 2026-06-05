import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecuteResult } from "@switchboard/schemas";
import { ApprovalLifecycleService } from "../lifecycle-service.js";
import { InMemoryLifecycleStore } from "../in-memory-lifecycle-store.js";
import {
  respondToParkedLifecycle,
  ParkedLifecycleNotFoundError,
  ParkedLifecycleAlreadyRespondedError,
  ParkedLifecycleExpiredError,
} from "../respond-to-parked-lifecycle.js";
import type { WorkTrace } from "../../platform/work-trace.js";
import type { WorkTraceStore } from "../../platform/work-trace-recorder.js";
import type { AuditLedger } from "../../audit/ledger.js";

function makeTrace(workUnitId: string, params: Record<string, unknown>): WorkTrace {
  return {
    workUnitId,
    traceId: `trace-${workUnitId}`,
    intent: "adoptimizer.recommendation.handoff",
    mode: "workflow",
    organizationId: "org_dev",
    actor: { id: "system", type: "system" },
    trigger: "internal",
    parameters: params,
    deploymentContext: {
      deploymentId: "dep-riley",
      skillSlug: "ad-optimizer",
      trustLevel: "guided",
      trustScore: 0,
    },
    governanceOutcome: "require_approval",
    riskScore: 0.4,
    matchedPolicies: [],
    outcome: "pending_approval",
    durationMs: 0,
    requestedAt: new Date().toISOString(),
    governanceCompletedAt: new Date().toISOString(),
    ingressPath: "platform_ingress",
    hashInputVersion: 2,
  } as WorkTrace;
}

function makeTraceStore(traces: Map<string, WorkTrace>): WorkTraceStore {
  return {
    persist: async (t: WorkTrace) => void traces.set(t.workUnitId, { ...t }),
    claim: async (t: WorkTrace) => {
      traces.set(t.workUnitId, { ...t });
      return { claimed: true as const };
    },
    getByWorkUnitId: async (id: string) => {
      const trace = traces.get(id);
      return trace ? { trace, integrity: { status: "ok" as const } } : null;
    },
    update: async (id: string, fields: Partial<WorkTrace>) => {
      const existing = traces.get(id);
      if (existing) traces.set(id, { ...existing, ...fields });
      return { ok: true as const, trace: traces.get(id)! };
    },
    getByIdempotencyKey: async () => null,
  } as unknown as WorkTraceStore;
}

function okResult(): ExecuteResult {
  return {
    success: true,
    summary: "ok",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 5,
    undoRecipe: null,
  };
}

describe("respondToParkedLifecycle", () => {
  let store: InMemoryLifecycleStore;
  let service: ApprovalLifecycleService;
  let traces: Map<string, WorkTrace>;
  let traceStore: WorkTraceStore;
  let executeApproved: ReturnType<typeof vi.fn>;
  const ledger = { record: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), error: vi.fn() };

  async function park(
    workUnitId = "wu-1",
    bindingHash = "h1",
    params: Record<string, unknown> = { campaignId: "camp-1" },
  ) {
    traces.set(workUnitId, makeTrace(workUnitId, params));
    const { lifecycle } = await store.createLifecycleWithRevision({
      actionEnvelopeId: workUnitId,
      organizationId: "org_dev",
      expiresAt: new Date(Date.now() + 3_600_000),
      initialRevision: {
        parametersSnapshot: params,
        approvalScopeSnapshot: {},
        bindingHash,
        createdBy: "system",
      },
    });
    return lifecycle;
  }

  function deps() {
    return {
      lifecycleService: service,
      workTraceStore: traceStore,
      platformLifecycle: { executeApproved },
      auditLedger: ledger as unknown as AuditLedger,
      logger,
    };
  }

  beforeEach(() => {
    store = new InMemoryLifecycleStore();
    service = new ApprovalLifecycleService({ store });
    traces = new Map();
    traceStore = makeTraceStore(traces);
    executeApproved = vi.fn().mockResolvedValue(okResult());
    ledger.record.mockClear();
  });

  it("approve drives approveLifecycle, trace approval fields, dispatch record, executeApproved", async () => {
    const lc = await park();
    const result = await respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    });

    expect(result.approvalState.status).toBe("approved");
    expect(result.executionResult?.success).toBe(true);
    expect(executeApproved).toHaveBeenCalledWith("wu-1");
    expect((await store.getLifecycleById(lc.id))?.status).toBe("approved");

    const trace = traces.get("wu-1");
    expect(trace?.approvalOutcome).toBe("approved");
    expect(trace?.approvalRespondedBy).toBe("operator_jane");

    const dispatches = store.listDispatchRecords();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.state).toBe("succeeded");
    expect(dispatches[0]?.idempotencyKey).toContain("attempt-1");

    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "action.approved" }),
    );
  });

  it("approve dispatches the APPROVED revision payload, not stale trace params (review 14A)", async () => {
    const lc = await park("wu-1", "h1", { campaignId: "approved" });
    traces.set("wu-1", { ...traces.get("wu-1")!, parameters: { campaignId: "old" } });

    let dispatchedParams: Record<string, unknown> | undefined;
    executeApproved.mockImplementation(async (workUnitId: string) => {
      // executeAfterApproval reads the trace at dispatch time; capture what it would see.
      dispatchedParams = traces.get(workUnitId)?.parameters;
      return okResult();
    });

    await respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    });

    expect(dispatchedParams).toEqual({ campaignId: "approved" });
    expect(dispatchedParams).not.toEqual({ campaignId: "old" });
  });

  it("reject drives rejectLifecycle and marks the trace failed", async () => {
    const lc = await park();
    const result = await respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "reject",
      respondedBy: "operator_jane",
    });
    expect(result.approvalState.status).toBe("rejected");
    expect(result.executionResult).toBeNull();
    expect(executeApproved).not.toHaveBeenCalled();
    expect((await store.getLifecycleById(lc.id))?.status).toBe("rejected");
    expect(traces.get("wu-1")?.outcome).toBe("failed");
    expect(traces.get("wu-1")?.approvalOutcome).toBe("rejected");
    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "action.rejected" }),
    );
  });

  it("reject tolerates a missing trace (degraded card remains rejectable)", async () => {
    const lc = await park();
    traces.delete("wu-1");
    const result = await respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "reject",
      respondedBy: "operator_jane",
    });
    expect(result.approvalState.status).toBe("rejected");
    expect((await store.getLifecycleById(lc.id))?.status).toBe("rejected");
  });

  it("refuses a stale binding hash without mutating state", async () => {
    const lc = await park();
    await expect(
      respondToParkedLifecycle(deps(), {
        lifecycleId: lc.id,
        action: "approve",
        respondedBy: "operator_jane",
        bindingHash: "wrong",
      }),
    ).rejects.toThrow(/stale/i);
    expect((await store.getLifecycleById(lc.id))?.status).toBe("pending");
    expect(executeApproved).not.toHaveBeenCalled();
  });

  it("refuses an already-responded lifecycle", async () => {
    const lc = await park();
    await respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "reject",
      respondedBy: "operator_jane",
    });
    await expect(
      respondToParkedLifecycle(deps(), {
        lifecycleId: lc.id,
        action: "approve",
        respondedBy: "operator_jane",
        bindingHash: "h1",
      }),
    ).rejects.toBeInstanceOf(ParkedLifecycleAlreadyRespondedError);
  });

  it("expires an overdue lifecycle instead of responding", async () => {
    traces.set("wu-old", makeTrace("wu-old", {}));
    const { lifecycle } = await store.createLifecycleWithRevision({
      actionEnvelopeId: "wu-old",
      organizationId: "org_dev",
      expiresAt: new Date(Date.now() - 1000),
      initialRevision: {
        parametersSnapshot: {},
        approvalScopeSnapshot: {},
        bindingHash: "h1",
        createdBy: "system",
      },
    });
    await expect(
      respondToParkedLifecycle(deps(), {
        lifecycleId: lifecycle.id,
        action: "approve",
        respondedBy: "operator_jane",
        bindingHash: "h1",
      }),
    ).rejects.toBeInstanceOf(ParkedLifecycleExpiredError);
    expect((await store.getLifecycleById(lifecycle.id))?.status).toBe("expired");
  });

  it("blocks self-approval (originator from the trace)", async () => {
    const lc = await park();
    await expect(
      respondToParkedLifecycle(deps(), {
        lifecycleId: lc.id,
        action: "approve",
        respondedBy: "system",
        bindingHash: "h1",
      }),
    ).rejects.toThrow(/self-approval/i);
  });

  it("404s an unknown lifecycle", async () => {
    await expect(
      respondToParkedLifecycle(deps(), {
        lifecycleId: "nope",
        action: "approve",
        respondedBy: "operator_jane",
        bindingHash: "h1",
      }),
    ).rejects.toBeInstanceOf(ParkedLifecycleNotFoundError);
  });

  it("transitions to recovery_required when executeApproved THROWS (review 14B)", async () => {
    executeApproved.mockRejectedValueOnce(new Error("mode blew up"));
    const lc = await park();
    await expect(
      respondToParkedLifecycle(deps(), {
        lifecycleId: lc.id,
        action: "approve",
        respondedBy: "operator_jane",
        bindingHash: "h1",
      }),
    ).rejects.toThrow("mode blew up");
    expect((await store.getLifecycleById(lc.id))?.status).toBe("recovery_required");
    expect(store.listDispatchRecords()[0]?.state).toBe("failed");
  });

  it("transitions to recovery_required when dispatch returns success:false (review 14B)", async () => {
    executeApproved.mockResolvedValueOnce({
      ...okResult(),
      success: false,
      summary: "handler failed",
    });
    const lc = await park();
    const result = await respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    });
    expect(result.executionResult?.success).toBe(false);
    expect((await store.getLifecycleById(lc.id))?.status).toBe("recovery_required");
    expect(store.listDispatchRecords()[0]?.state).toBe("failed");
  });

  it("RETRY: approve on recovery_required re-dispatches with attempt 2 and recovers", async () => {
    executeApproved.mockResolvedValueOnce({
      ...okResult(),
      success: false,
      summary: "first failure",
    });
    const lc = await park();
    await respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    });
    expect((await store.getLifecycleById(lc.id))?.status).toBe("recovery_required");

    const result = await respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    });
    expect(result.executionResult?.success).toBe(true);
    expect((await store.getLifecycleById(lc.id))?.status).toBe("approved");
    const records = store.listDispatchRecords();
    expect(records).toHaveLength(2);
    expect(records[1]?.attemptNumber).toBe(2);
    expect(records[1]?.state).toBe("succeeded");
    expect(records[1]?.idempotencyKey).toContain("attempt-2");
  });

  it("RETRY: reject on recovery_required is refused (already approved)", async () => {
    executeApproved.mockResolvedValueOnce({
      ...okResult(),
      success: false,
      summary: "first failure",
    });
    const lc = await park();
    await respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    });
    await expect(
      respondToParkedLifecycle(deps(), {
        lifecycleId: lc.id,
        action: "reject",
        respondedBy: "operator_jane",
      }),
    ).rejects.toBeInstanceOf(ParkedLifecycleAlreadyRespondedError);
  });
});
