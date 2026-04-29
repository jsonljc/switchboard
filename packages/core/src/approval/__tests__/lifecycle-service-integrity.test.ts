/**
 * Admission gate integration tests for ApprovalLifecycleService.rejectLifecycle.
 *
 * Verifies that the call site at lifecycle-service.ts:151 (getByWorkUnitId +
 * assertExecutionAdmissible) fires correctly:
 *   - "ok" verdict → traceStore.update() is called, lifecycle proceeds.
 *   - Non-"ok" verdict (without override) → WorkTraceIntegrityError thrown,
 *     traceStore.update() is NOT called.
 *
 * Uses the same fixture pattern as lifecycle-service.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApprovalLifecycleService } from "../lifecycle-service.js";
import { WorkTraceIntegrityError } from "../../platform/work-trace-integrity.js";
import type { ApprovalLifecycleStore, LifecycleRecord } from "../lifecycle-types.js";
import type { WorkTraceStore, WorkTraceReadResult } from "../../platform/work-trace-recorder.js";
import type { IntegrityVerdict } from "../../platform/work-trace-integrity.js";
import type { WorkTrace } from "../../platform/work-trace.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENVELOPE_ID = "env-reject-integrity";

function makeBaseTrace(): WorkTrace {
  return {
    workUnitId: ENVELOPE_ID,
    traceId: "trace-reject-integrity",
    intent: "campaign.pause",
    mode: "skill",
    organizationId: "org-1",
    actor: { id: "originator", type: "user" },
    trigger: "api",
    governanceOutcome: "require_approval",
    riskScore: 0.4,
    matchedPolicies: [],
    outcome: "pending_approval",
    durationMs: 0,
    requestedAt: "2026-04-29T12:00:00.000Z",
    governanceCompletedAt: "2026-04-29T12:00:05.000Z",
  };
}

function makeLifecycleRecord(overrides?: Partial<LifecycleRecord>): LifecycleRecord {
  return {
    id: "lc-integrity",
    actionEnvelopeId: ENVELOPE_ID,
    organizationId: "org-1",
    status: "pending",
    currentRevisionId: "rev-1",
    currentExecutableWorkUnitId: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    pausedSessionId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStore(lifecycle: LifecycleRecord): ApprovalLifecycleStore {
  const rejectedLifecycle: LifecycleRecord = { ...lifecycle, status: "rejected" };
  return {
    createLifecycleWithRevision: vi.fn(),
    getLifecycleById: vi.fn().mockResolvedValue(lifecycle),
    getLifecycleByEnvelopeId: vi.fn(),
    getRevision: vi.fn(),
    getRevisionById: vi.fn(),
    getCurrentRevision: vi.fn(),
    createRevision: vi.fn(),
    updateLifecycleStatus: vi.fn().mockResolvedValue(rejectedLifecycle),
    materializeWorkUnit: vi.fn(),
    approveAndMaterialize: vi.fn(),
    getExecutableWorkUnit: vi.fn(),
    createDispatchRecord: vi.fn(),
    updateDispatchRecord: vi.fn(),
    listPendingLifecycles: vi.fn(),
    listExpiredPendingLifecycles: vi.fn(),
  };
}

function makeTraceStore(verdict: IntegrityVerdict): WorkTraceStore {
  const trace = makeBaseTrace();
  const readResult: WorkTraceReadResult = { trace, integrity: verdict };
  return {
    persist: vi.fn().mockResolvedValue(undefined),
    getByWorkUnitId: vi.fn().mockResolvedValue(readResult),
    getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ ok: true as const, trace }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApprovalLifecycleService.rejectLifecycle — admission gate", () => {
  let service: ApprovalLifecycleService;
  let lifecycleRecord: LifecycleRecord;

  beforeEach(() => {
    lifecycleRecord = makeLifecycleRecord();
    service = new ApprovalLifecycleService({ store: makeStore(lifecycleRecord) });
  });

  describe("when integrity verdict is ok", () => {
    it("calls traceStore.update() with rejected outcome", async () => {
      const traceStore = makeTraceStore({ status: "ok" });

      const result = await service.rejectLifecycle({
        lifecycleId: "lc-integrity",
        respondedBy: "approver-1",
        traceStore,
      });

      expect(result.status).toBe("rejected");
      expect(traceStore.update).toHaveBeenCalledWith(
        ENVELOPE_ID,
        expect.objectContaining({
          outcome: "failed",
          approvalOutcome: "rejected",
          approvalRespondedBy: "approver-1",
        }),
      );
    });
  });

  describe("when integrity verdict is mismatch", () => {
    it("throws WorkTraceIntegrityError and does NOT call traceStore.update()", async () => {
      const traceStore = makeTraceStore({
        status: "mismatch",
        expected: "hash-expected",
        actual: "hash-actual",
      });

      await expect(
        service.rejectLifecycle({
          lifecycleId: "lc-integrity",
          respondedBy: "approver-1",
          traceStore,
        }),
      ).rejects.toThrow(WorkTraceIntegrityError);

      expect(traceStore.update).not.toHaveBeenCalled();
    });
  });

  describe("when integrity verdict is missing_anchor", () => {
    it("throws WorkTraceIntegrityError and does NOT call traceStore.update()", async () => {
      const traceStore = makeTraceStore({
        status: "missing_anchor",
        expectedAtVersion: 3,
      });

      await expect(
        service.rejectLifecycle({
          lifecycleId: "lc-integrity",
          respondedBy: "approver-1",
          traceStore,
        }),
      ).rejects.toThrow(WorkTraceIntegrityError);

      expect(traceStore.update).not.toHaveBeenCalled();
    });
  });

  describe("when integrity verdict is skipped (pre-migration)", () => {
    it("throws WorkTraceIntegrityError and does NOT call traceStore.update()", async () => {
      const traceStore = makeTraceStore({
        status: "skipped",
        reason: "pre_migration",
      });

      await expect(
        service.rejectLifecycle({
          lifecycleId: "lc-integrity",
          respondedBy: "approver-1",
          traceStore,
        }),
      ).rejects.toThrow(WorkTraceIntegrityError);

      expect(traceStore.update).not.toHaveBeenCalled();
    });
  });

  describe("when trace is not found (getByWorkUnitId returns null)", () => {
    it("skips the admission check and calls traceStore.update() regardless", async () => {
      const trace = makeBaseTrace();
      const traceStore: WorkTraceStore = {
        persist: vi.fn().mockResolvedValue(undefined),
        getByWorkUnitId: vi.fn().mockResolvedValue(null),
        getByIdempotencyKey: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ ok: true as const, trace }),
      };

      // When trace is null, assertExecutionAdmissible is not called (guarded by if (readResult))
      const result = await service.rejectLifecycle({
        lifecycleId: "lc-integrity",
        respondedBy: "approver-1",
        traceStore,
      });

      expect(result.status).toBe("rejected");
      expect(traceStore.update).toHaveBeenCalledOnce();
    });
  });
});
