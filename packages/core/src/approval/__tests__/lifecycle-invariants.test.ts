import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApprovalLifecycleService } from "../lifecycle-service.js";
import type { ApprovalLifecycleStore, LifecycleRecord } from "../lifecycle-types.js";
import type { ApprovalRevision, ExecutableWorkUnit, ApprovalLifecycle } from "@switchboard/schemas";
import type { WorkUnit } from "../../platform/work-unit.js";
import { StaleVersionError } from "../state-machine.js";
import { validateDispatchAdmission, DispatchAdmissionError } from "../dispatch-admission.js";

function makeStore(): ApprovalLifecycleStore {
  return {
    createLifecycleWithRevision: vi.fn(),
    getLifecycleById: vi.fn(),
    getLifecycleByEnvelopeId: vi.fn(),
    getRevision: vi.fn(),
    getRevisionById: vi.fn(),
    getCurrentRevision: vi.fn(),
    createRevision: vi.fn(),
    updateLifecycleStatus: vi.fn(),
    materializeWorkUnit: vi.fn(),
    getExecutableWorkUnit: vi.fn(),
    createDispatchRecord: vi.fn(),
    updateDispatchRecord: vi.fn(),
    listPendingLifecycles: vi.fn(),
    listExpiredPendingLifecycles: vi.fn(),
  };
}

function makeLifecycle(overrides?: Partial<LifecycleRecord>): LifecycleRecord {
  return {
    id: "lc-1",
    actionEnvelopeId: "env-1",
    organizationId: "org-1",
    status: "pending",
    currentRevisionId: "rev-1",
    currentExecutableWorkUnitId: null,
    expiresAt: new Date(Date.now() + 3600000),
    pausedSessionId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRevision(overrides?: Partial<ApprovalRevision>): ApprovalRevision {
  return {
    id: "rev-1",
    lifecycleId: "lc-1",
    revisionNumber: 1,
    parametersSnapshot: { foo: "bar" },
    approvalScopeSnapshot: { risk: "low" },
    bindingHash: "hash-123",
    rationale: null,
    supersedesRevisionId: null,
    createdBy: "user-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeWorkUnit(overrides?: Partial<WorkUnit>): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date().toISOString(),
    intent: "test.action",
    parameters: { foo: "bar" },
    actor: { type: "user", id: "user-1" },
    organizationId: "org-1",
    resolvedMode: "skill",
    traceId: "trace-1",
    trigger: "api",
    priority: "normal",
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "test-skill",
      trustLevel: "supervised",
      trustScore: 0,
    },
    ...overrides,
  } as WorkUnit;
}

function makeExecutableWorkUnit(overrides?: Partial<ExecutableWorkUnit>): ExecutableWorkUnit {
  return {
    id: "wu-1",
    lifecycleId: "lc-1",
    approvalRevisionId: "rev-1",
    actionEnvelopeId: "env-1",
    frozenPayload: {},
    frozenBinding: {},
    frozenExecutionPolicy: {},
    executableUntil: new Date(Date.now() + 3600000),
    createdAt: new Date(),
    ...overrides,
  };
}

function toApprovalLifecycle(record: LifecycleRecord): ApprovalLifecycle {
  return {
    id: record.id,
    actionEnvelopeId: record.actionEnvelopeId,
    organizationId: record.organizationId,
    status: record.status,
    currentRevisionId: record.currentRevisionId,
    currentExecutableWorkUnitId: record.currentExecutableWorkUnitId,
    expiresAt: record.expiresAt,
    pausedSessionId: record.pausedSessionId,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

describe("Lifecycle Trust Invariants", () => {
  let service: ApprovalLifecycleService;
  let store: ApprovalLifecycleStore;

  beforeEach(() => {
    store = makeStore();
    service = new ApprovalLifecycleService({ store });
  });

  describe("INVARIANT: no approval response can execute stale work", () => {
    it("rejects dispatch when lifecycle pointer has moved to different work unit", () => {
      const lifecycle = toApprovalLifecycle(
        makeLifecycle({
          status: "approved",
          currentExecutableWorkUnitId: "wu-2",
        }),
      );
      const staleWorkUnit = makeExecutableWorkUnit({
        id: "wu-1",
        lifecycleId: "lc-1",
      });

      expect(() => validateDispatchAdmission(lifecycle, staleWorkUnit)).toThrow(
        DispatchAdmissionError,
      );

      try {
        validateDispatchAdmission(lifecycle, staleWorkUnit);
      } catch (error) {
        if (error instanceof DispatchAdmissionError) {
          expect(error.code).toBe("STALE_AUTHORITY");
          expect(error.message).toContain("wu-1");
          expect(error.message).toContain("wu-2");
        }
      }
    });

    it("allows dispatch when work unit matches current lifecycle pointer", () => {
      const lifecycle = toApprovalLifecycle(
        makeLifecycle({
          status: "approved",
          currentExecutableWorkUnitId: "wu-1",
        }),
      );
      const currentWorkUnit = makeExecutableWorkUnit({
        id: "wu-1",
        lifecycleId: "lc-1",
      });

      expect(() => validateDispatchAdmission(lifecycle, currentWorkUnit)).not.toThrow();
    });
  });

  describe("INVARIANT: patch creates new revision, never mutates", () => {
    it("produces new revision with supersedesRevisionId set", async () => {
      const lifecycle = makeLifecycle({
        currentRevisionId: "rev-1",
      });
      const currentRevision = makeRevision({
        id: "rev-1",
        revisionNumber: 1,
        bindingHash: "hash-old",
      });
      const newRevision = makeRevision({
        id: "rev-2",
        revisionNumber: 2,
        bindingHash: "hash-new",
        supersedesRevisionId: "rev-1",
      });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getCurrentRevision).mockResolvedValue(currentRevision);
      vi.mocked(store.createRevision).mockResolvedValue(newRevision);

      const result = await service.createRevision({
        lifecycleId: "lc-1",
        parametersSnapshot: { foo: "updated" },
        approvalScopeSnapshot: { risk: "medium" },
        bindingHash: "hash-new",
        createdBy: "user-2",
        sourceBindingHash: "hash-old",
      });

      expect(result.id).toBe("rev-2");
      expect(result.supersedesRevisionId).toBe("rev-1");
      expect(store.createRevision).toHaveBeenCalledWith({
        lifecycleId: "lc-1",
        parametersSnapshot: { foo: "updated" },
        approvalScopeSnapshot: { risk: "medium" },
        bindingHash: "hash-new",
        rationale: null,
        supersedesRevisionId: "rev-1",
        createdBy: "user-2",
      });
    });

    it("does not modify the original revision in place", async () => {
      const lifecycle = makeLifecycle();
      const currentRevision = makeRevision({
        id: "rev-1",
        bindingHash: "hash-old",
      });
      const originalHash = currentRevision.bindingHash;
      const newRevision = makeRevision({
        id: "rev-2",
        revisionNumber: 2,
        bindingHash: "hash-new",
        supersedesRevisionId: "rev-1",
      });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getCurrentRevision).mockResolvedValue(currentRevision);
      vi.mocked(store.createRevision).mockResolvedValue(newRevision);

      await service.createRevision({
        lifecycleId: "lc-1",
        parametersSnapshot: {},
        approvalScopeSnapshot: {},
        bindingHash: "hash-new",
        createdBy: "user-1",
        sourceBindingHash: "hash-old",
      });

      expect(currentRevision.bindingHash).toBe(originalHash);
    });
  });

  describe("INVARIANT: approve materializes before dispatch is possible", () => {
    it("materializes work unit and sets lifecycle pointer atomically", async () => {
      const lifecycle = makeLifecycle();
      const currentRevision = makeRevision({ bindingHash: "hash-123" });
      const workUnit = makeWorkUnit();
      const executableWorkUnit = makeExecutableWorkUnit({ id: "wu-1" });
      const approvedLifecycle = makeLifecycle({
        status: "approved",
        currentExecutableWorkUnitId: "wu-1",
        version: 2,
      });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getCurrentRevision).mockResolvedValue(currentRevision);
      vi.mocked(store.materializeWorkUnit).mockResolvedValue(executableWorkUnit);
      vi.mocked(store.updateLifecycleStatus).mockResolvedValue(approvedLifecycle);

      const result = await service.approveRevision({
        lifecycleId: "lc-1",
        respondedBy: "approver-1",
        clientBindingHash: "hash-123",
        materializationParams: {
          workUnit,
          actionEnvelopeId: "env-1",
          constraints: {},
          executableUntilMs: 3600000,
        },
      });

      expect(result.lifecycle.status).toBe("approved");
      expect(result.lifecycle.currentExecutableWorkUnitId).toBe("wu-1");
      expect(result.workUnit.id).toBe("wu-1");

      expect(store.materializeWorkUnit).toHaveBeenCalled();
      expect(store.updateLifecycleStatus).toHaveBeenCalled();
    });

    it("validates dispatch admission requires approved status with materialized work unit", () => {
      const pendingLifecycle = toApprovalLifecycle(
        makeLifecycle({
          status: "pending",
          currentExecutableWorkUnitId: null,
        }),
      );
      const workUnit = makeExecutableWorkUnit();

      expect(() => validateDispatchAdmission(pendingLifecycle, workUnit)).toThrow(
        DispatchAdmissionError,
      );
    });
  });

  describe("INVARIANT: rejected/expired lifecycle cannot dispatch", () => {
    it("blocks dispatch for rejected lifecycle", () => {
      const rejectedLifecycle = toApprovalLifecycle(
        makeLifecycle({
          status: "rejected",
          currentExecutableWorkUnitId: "wu-1",
        }),
      );
      const workUnit = makeExecutableWorkUnit({ id: "wu-1" });

      expect(() => validateDispatchAdmission(rejectedLifecycle, workUnit)).toThrow(
        DispatchAdmissionError,
      );

      try {
        validateDispatchAdmission(rejectedLifecycle, workUnit);
      } catch (error) {
        if (error instanceof DispatchAdmissionError) {
          expect(error.code).toBe("LIFECYCLE_NOT_APPROVED");
          expect(error.message).toContain("rejected");
        }
      }
    });

    it("blocks dispatch for expired lifecycle", () => {
      const expiredLifecycle = toApprovalLifecycle(
        makeLifecycle({
          status: "expired",
          currentExecutableWorkUnitId: "wu-1",
        }),
      );
      const workUnit = makeExecutableWorkUnit({ id: "wu-1" });

      expect(() => validateDispatchAdmission(expiredLifecycle, workUnit)).toThrow(
        DispatchAdmissionError,
      );

      try {
        validateDispatchAdmission(expiredLifecycle, workUnit);
      } catch (error) {
        if (error instanceof DispatchAdmissionError) {
          expect(error.code).toBe("LIFECYCLE_NOT_APPROVED");
          expect(error.message).toContain("expired");
        }
      }
    });

    it("allows dispatch for approved lifecycle", () => {
      const approvedLifecycle = toApprovalLifecycle(
        makeLifecycle({
          status: "approved",
          currentExecutableWorkUnitId: "wu-1",
        }),
      );
      const workUnit = makeExecutableWorkUnit({ id: "wu-1" });

      expect(() => validateDispatchAdmission(approvedLifecycle, workUnit)).not.toThrow();
    });
  });

  describe("INVARIANT: concurrent approve uses optimistic concurrency", () => {
    it("second approve fails with StaleVersionError when version has advanced", async () => {
      const lifecycle = makeLifecycle({ version: 1 });
      const currentRevision = makeRevision({ bindingHash: "hash-123" });
      const workUnit = makeWorkUnit();
      const executableWorkUnit = makeExecutableWorkUnit();

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getCurrentRevision).mockResolvedValue(currentRevision);
      vi.mocked(store.materializeWorkUnit).mockResolvedValue(executableWorkUnit);
      vi.mocked(store.updateLifecycleStatus).mockRejectedValue(new StaleVersionError("lc-1", 2, 1));

      await expect(
        service.approveRevision({
          lifecycleId: "lc-1",
          respondedBy: "approver-2",
          clientBindingHash: "hash-123",
          materializationParams: {
            workUnit,
            actionEnvelopeId: "env-1",
            constraints: {},
            executableUntilMs: 3600000,
          },
        }),
      ).rejects.toThrow(StaleVersionError);
    });

    it("passes expected version to updateLifecycleStatus for optimistic lock", async () => {
      const lifecycle = makeLifecycle({ version: 3 });
      const currentRevision = makeRevision({ bindingHash: "hash-123" });
      const workUnit = makeWorkUnit();
      const executableWorkUnit = makeExecutableWorkUnit();
      const approvedLifecycle = makeLifecycle({
        status: "approved",
        currentExecutableWorkUnitId: "wu-1",
        version: 4,
      });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getCurrentRevision).mockResolvedValue(currentRevision);
      vi.mocked(store.materializeWorkUnit).mockResolvedValue(executableWorkUnit);
      vi.mocked(store.updateLifecycleStatus).mockResolvedValue(approvedLifecycle);

      await service.approveRevision({
        lifecycleId: "lc-1",
        respondedBy: "approver-1",
        clientBindingHash: "hash-123",
        materializationParams: {
          workUnit,
          actionEnvelopeId: "env-1",
          constraints: {},
          executableUntilMs: 3600000,
        },
      });

      expect(store.updateLifecycleStatus).toHaveBeenCalledWith("lc-1", "approved", 3, {
        currentExecutableWorkUnitId: "wu-1",
      });
    });
  });

  describe("INVARIANT: pending reads filter expired", () => {
    it("listPendingLifecycles excludes expired-but-not-swept lifecycles", async () => {
      const now = Date.now();
      const validLifecycle = makeLifecycle({
        id: "lc-valid",
        expiresAt: new Date(now + 3600000),
      });
      const expiredLifecycle = makeLifecycle({
        id: "lc-expired",
        status: "pending",
        expiresAt: new Date(now - 1000),
      });

      vi.mocked(store.listPendingLifecycles).mockResolvedValue([validLifecycle, expiredLifecycle]);

      const result = await service.listPendingLifecycles();

      expect(result).toEqual([validLifecycle]);
      expect(result).not.toContainEqual(expiredLifecycle);
    });

    it("includes lifecycle that expires in the future", async () => {
      const now = Date.now();
      const futureExpiry = makeLifecycle({
        expiresAt: new Date(now + 1000),
      });

      vi.mocked(store.listPendingLifecycles).mockResolvedValue([futureExpiry]);

      const result = await service.listPendingLifecycles();

      expect(result).toEqual([futureExpiry]);
    });

    it("excludes lifecycle that just expired", async () => {
      const now = Date.now();
      const justExpired = makeLifecycle({
        expiresAt: new Date(now - 1),
      });

      vi.mocked(store.listPendingLifecycles).mockResolvedValue([justExpired]);

      const result = await service.listPendingLifecycles();

      expect(result).toEqual([]);
    });
  });
});
