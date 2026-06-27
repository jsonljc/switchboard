import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecuteResult, ExecutableWorkUnit } from "@switchboard/schemas";
import { ApprovalLifecycleService } from "../lifecycle-service.js";
import { InMemoryLifecycleStore } from "../in-memory-lifecycle-store.js";
import { respondToParkedLifecycle } from "../respond-to-parked-lifecycle.js";
import { writeApprovedPayloadToTrace } from "../lifecycle-dispatch.js";
import type { LifecycleRecord } from "../lifecycle-types.js";
import type { WorkTrace } from "../../platform/work-trace.js";
import type { WorkTraceStore } from "../../platform/work-trace-recorder.js";
import type { AuditLedger } from "../../audit/ledger.js";

// ---------------------------------------------------------------------------
// EV-9b / GOV-4 — a payload-authority write rejection must leave the lifecycle
// approved-but-UNDISPATCHED.
//
// writeApprovedPayloadToTrace (lifecycle-dispatch.ts:47-82) commits the approved
// frozen payload onto the WorkTrace BEFORE dispatch — executeApproved dispatches
// FROM the trace, so the trace write is the payload-authority gate. The contract
// (spec 4.1): when the trace store rejects that write (integrity-locked trace),
// the function THROWS, the caller never reaches runDispatch, and the lifecycle
// stays "approved" — it does NOT falsely advance to a dispatched/completed
// state. Approved governed work that cannot be authoritatively staged must not
// be reported as executed.
// ---------------------------------------------------------------------------

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

/** Trace store whose `update` ALWAYS rejects (integrity-locked), but whose reads
 * succeed so approveLifecycle (which does not touch the trace store) proceeds and
 * the failure is isolated to the payload-authority write. */
function makeRejectingUpdateTraceStore(traces: Map<string, WorkTrace>): {
  store: WorkTraceStore;
  update: ReturnType<typeof vi.fn>;
} {
  const update = vi.fn(async () => ({ ok: false as const, reason: "trace integrity-locked" }));
  const store = {
    persist: async (t: WorkTrace) => void traces.set(t.workUnitId, { ...t }),
    claim: async (t: WorkTrace) => {
      traces.set(t.workUnitId, { ...t });
      return { claimed: true as const };
    },
    getByWorkUnitId: async (id: string) => {
      const trace = traces.get(id);
      return trace ? { trace, integrity: { status: "ok" as const } } : null;
    },
    update,
    getByIdempotencyKey: async () => null,
  } as unknown as WorkTraceStore;
  return { store, update };
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

describe("writeApprovedPayloadToTrace — GOV-4: rejection blocks dispatch", () => {
  it("throws when the trace store rejects the payload-authority write", async () => {
    const update = vi.fn(async () => ({ ok: false as const, reason: "trace integrity-locked" }));
    const workTraceStore = { update } as unknown as WorkTraceStore;

    await expect(
      writeApprovedPayloadToTrace({
        deps: { workTraceStore },
        lifecycle: {
          id: "lc-1",
          actionEnvelopeId: "wu-1",
          organizationId: "org_dev",
        } as unknown as LifecycleRecord,
        executableWorkUnit: {
          frozenPayload: { parameters: { campaignId: "camp-1" } },
        } as unknown as ExecutableWorkUnit,
        fallbackParameters: { campaignId: "camp-1" },
        approvalOutcome: "approved",
        respondedBy: "operator_jane",
        respondedAt: new Date().toISOString(),
        caller: "test",
      }),
    ).rejects.toThrow(/WorkTrace update rejected before dispatch/);

    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("respondToParkedLifecycle — GOV-4: write rejection leaves approved-but-undispatched", () => {
  let store: InMemoryLifecycleStore;
  let service: ApprovalLifecycleService;
  let traces: Map<string, WorkTrace>;
  let executeApproved: ReturnType<typeof vi.fn>;
  const ledger = { record: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), error: vi.fn() };

  async function park(workUnitId = "wu-1", bindingHash = "h1") {
    const params = { campaignId: "camp-1" };
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

  beforeEach(() => {
    store = new InMemoryLifecycleStore();
    service = new ApprovalLifecycleService({ store });
    traces = new Map();
    executeApproved = vi.fn().mockResolvedValue(okResult());
    ledger.record.mockClear();
  });

  it("throws, never dispatches, and the lifecycle stays approved (not advanced)", async () => {
    const lc = await park();
    const { store: traceStore, update } = makeRejectingUpdateTraceStore(traces);

    await expect(
      respondToParkedLifecycle(
        {
          lifecycleService: service,
          workTraceStore: traceStore,
          platformLifecycle: { executeApproved },
          auditLedger: ledger as unknown as AuditLedger,
          logger,
        },
        { lifecycleId: lc.id, action: "approve", respondedBy: "operator_jane", bindingHash: "h1" },
      ),
    ).rejects.toThrow(/WorkTrace update rejected before dispatch/);

    // The payload-authority write was attempted and rejected...
    expect(update).toHaveBeenCalled();
    // ...so dispatch NEVER ran (no false "executed").
    expect(executeApproved).not.toHaveBeenCalled();
    // ...and the lifecycle is approved-but-undispatched, NOT advanced to a
    // dispatched/recovery_required/completed terminal.
    const after = await service.getLifecycleById(lc.id);
    expect(after?.status).toBe("approved");
  });

  it("positive control: a succeeding write DOES dispatch (the guard is not vacuous)", async () => {
    const lc = await park();
    const okStore = {
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

    const result = await respondToParkedLifecycle(
      {
        lifecycleService: service,
        workTraceStore: okStore,
        platformLifecycle: { executeApproved },
        auditLedger: ledger as unknown as AuditLedger,
        logger,
      },
      { lifecycleId: lc.id, action: "approve", respondedBy: "operator_jane", bindingHash: "h1" },
    );

    expect(executeApproved).toHaveBeenCalledTimes(1);
    expect(result.executionResult?.success).toBe(true);
  });
});
