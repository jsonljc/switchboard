import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ApprovalLifecycleStore,
  LifecycleRecord,
  CreateLifecycleInput,
} from "../lifecycle-types.js";
import type { ApprovalRevision, ExecutableWorkUnit } from "@switchboard/schemas";
import type { WorkUnit } from "../../platform/work-unit.js";
import { ApprovalLifecycleService } from "../lifecycle-service.js";
import { DispatchAdmissionError } from "../dispatch-admission.js";

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
    approveAndMaterialize: vi.fn(),
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

describe("ApprovalLifecycleService", () => {
  let service: ApprovalLifecycleService;
  let store: ApprovalLifecycleStore;

  beforeEach(() => {
    store = makeStore();
    service = new ApprovalLifecycleService({ store });
  });

  describe("createGatedLifecycle", () => {
    it("creates lifecycle and initial revision atomically", async () => {
      const input: CreateLifecycleInput = {
        actionEnvelopeId: "env-1",
        organizationId: "org-1",
        expiresAt: new Date(Date.now() + 3600000),
        initialRevision: {
          parametersSnapshot: { foo: "bar" },
          approvalScopeSnapshot: { risk: "low" },
          bindingHash: "hash-123",
          createdBy: "user-1",
        },
      };
      const lifecycle = makeLifecycle();
      const revision = makeRevision();

      vi.mocked(store.createLifecycleWithRevision).mockResolvedValue({ lifecycle, revision });

      const result = await service.createGatedLifecycle(input);

      expect(store.createLifecycleWithRevision).toHaveBeenCalledWith(input);
      expect(result).toEqual({ lifecycle, revision });
    });
  });

  describe("createRevision", () => {
    it("creates new immutable revision and updates lifecycle pointer", async () => {
      const lifecycle = makeLifecycle();
      const currentRevision = makeRevision({ bindingHash: "hash-old" });
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
        parametersSnapshot: { foo: "baz" },
        approvalScopeSnapshot: { risk: "medium" },
        bindingHash: "hash-new",
        createdBy: "user-2",
        sourceBindingHash: "hash-old",
      });

      expect(result).toEqual(newRevision);
      expect(store.createRevision).toHaveBeenCalledWith({
        lifecycleId: "lc-1",
        parametersSnapshot: { foo: "baz" },
        approvalScopeSnapshot: { risk: "medium" },
        bindingHash: "hash-new",
        rationale: null,
        supersedesRevisionId: "rev-1",
        createdBy: "user-2",
      });
    });

    it("rejects when lifecycle is not pending", async () => {
      const lifecycle = makeLifecycle({ status: "approved" });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);

      await expect(
        service.createRevision({
          lifecycleId: "lc-1",
          parametersSnapshot: {},
          approvalScopeSnapshot: {},
          bindingHash: "hash-new",
          createdBy: "user-1",
          sourceBindingHash: "hash-old",
        }),
      ).rejects.toThrow('Cannot create revision: lifecycle status is "approved"');
    });

    it("rejects when source binding hash doesn't match current revision", async () => {
      const lifecycle = makeLifecycle();
      const currentRevision = makeRevision({ bindingHash: "hash-current" });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getCurrentRevision).mockResolvedValue(currentRevision);

      await expect(
        service.createRevision({
          lifecycleId: "lc-1",
          parametersSnapshot: {},
          approvalScopeSnapshot: {},
          bindingHash: "hash-new",
          createdBy: "user-1",
          sourceBindingHash: "hash-wrong",
        }),
      ).rejects.toThrow("Stale binding: source binding hash does not match current revision");
    });
  });

  describe("approveRevision", () => {
    it("approves, materializes work unit, updates lifecycle pointer", async () => {
      const lifecycle = makeLifecycle();
      const currentRevision = makeRevision({ bindingHash: "hash-123" });
      const workUnit = makeWorkUnit();
      const executableWorkUnit = makeExecutableWorkUnit();
      const approvedLifecycle = makeLifecycle({
        status: "approved",
        currentExecutableWorkUnitId: "wu-1",
      });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getCurrentRevision).mockResolvedValue(currentRevision);
      vi.mocked(store.approveAndMaterialize).mockResolvedValue({
        lifecycle: approvedLifecycle,
        workUnit: executableWorkUnit,
      });

      const result = await service.approveRevision({
        lifecycleId: "lc-1",
        respondedBy: "approver-1",
        clientBindingHash: "hash-123",
        materializationParams: {
          workUnit,
          actionEnvelopeId: "env-1",
          constraints: { maxRetries: 3 },
          executableUntilMs: 3600000,
        },
      });

      expect(result.lifecycle).toEqual(approvedLifecycle);
      expect(result.workUnit).toEqual(executableWorkUnit);
      expect(store.approveAndMaterialize).toHaveBeenCalledWith(
        "lc-1",
        1,
        expect.objectContaining({ lifecycleId: "lc-1" }),
      );
    });

    it("rejects when lifecycle is not pending", async () => {
      const lifecycle = makeLifecycle({ status: "approved" });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);

      await expect(
        service.approveRevision({
          lifecycleId: "lc-1",
          respondedBy: "approver-1",
          clientBindingHash: "hash-123",
          materializationParams: {
            workUnit: makeWorkUnit(),
            actionEnvelopeId: "env-1",
            constraints: {},
            executableUntilMs: 3600000,
          },
        }),
      ).rejects.toThrow('Cannot approve: lifecycle status is "approved"');
    });

    it("rejects when client binding hash doesn't match", async () => {
      const lifecycle = makeLifecycle();
      const currentRevision = makeRevision({ bindingHash: "hash-current" });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getCurrentRevision).mockResolvedValue(currentRevision);

      await expect(
        service.approveRevision({
          lifecycleId: "lc-1",
          respondedBy: "approver-1",
          clientBindingHash: "hash-wrong",
          materializationParams: {
            workUnit: makeWorkUnit(),
            actionEnvelopeId: "env-1",
            constraints: {},
            executableUntilMs: 3600000,
          },
        }),
      ).rejects.toThrow("Stale binding: client binding hash does not match current revision");
    });
  });

  describe("rejectRevision", () => {
    it("transitions to rejected", async () => {
      const lifecycle = makeLifecycle();
      const rejectedLifecycle = makeLifecycle({ status: "rejected" });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.updateLifecycleStatus).mockResolvedValue(rejectedLifecycle);

      const result = await service.rejectRevision({
        lifecycleId: "lc-1",
        respondedBy: "approver-1",
      });

      expect(result).toEqual(rejectedLifecycle);
      expect(store.updateLifecycleStatus).toHaveBeenCalledWith("lc-1", "rejected", 1);
    });

    it("rejects when not pending", async () => {
      const lifecycle = makeLifecycle({ status: "approved" });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);

      await expect(
        service.rejectRevision({
          lifecycleId: "lc-1",
          respondedBy: "approver-1",
        }),
      ).rejects.toThrow('Cannot reject: lifecycle status is "approved"');
    });
  });

  describe("expireLifecycle", () => {
    it("transitions pending to expired", async () => {
      const lifecycle = makeLifecycle();
      const expiredLifecycle = makeLifecycle({ status: "expired" });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.updateLifecycleStatus).mockResolvedValue(expiredLifecycle);

      const result = await service.expireLifecycle("lc-1");

      expect(result).toEqual(expiredLifecycle);
      expect(store.updateLifecycleStatus).toHaveBeenCalledWith("lc-1", "expired", 1);
    });

    it("skips if already approved", async () => {
      const lifecycle = makeLifecycle({ status: "approved" });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);

      const result = await service.expireLifecycle("lc-1");

      expect(result).toEqual(lifecycle);
      expect(store.updateLifecycleStatus).not.toHaveBeenCalled();
    });
  });

  describe("listPendingLifecycles", () => {
    it("filters out expired-but-not-swept lifecycles", async () => {
      const validLifecycle = makeLifecycle({ expiresAt: new Date(Date.now() + 3600000) });
      const expiredLifecycle = makeLifecycle({
        id: "lc-2",
        expiresAt: new Date(Date.now() - 1000),
      });

      vi.mocked(store.listPendingLifecycles).mockResolvedValue([validLifecycle, expiredLifecycle]);

      const result = await service.listPendingLifecycles();

      expect(result).toEqual([validLifecycle]);
    });
  });

  describe("prepareDispatch", () => {
    it("creates dispatch record after admission check", async () => {
      const lifecycle = makeLifecycle({
        status: "approved",
        currentExecutableWorkUnitId: "wu-1",
      });
      const workUnit = makeExecutableWorkUnit({
        id: "wu-1",
        lifecycleId: "lc-1",
        executableUntil: new Date(Date.now() + 3600000),
      });
      const dispatchRecord = {
        id: "dispatch-1",
        executableWorkUnitId: "wu-1",
        attemptNumber: 1,
        idempotencyKey: "idem-1",
        state: "dispatching" as const,
        outcome: null,
        errorMessage: null,
        dispatchedAt: new Date(),
        completedAt: null,
        durationMs: null,
      };

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getExecutableWorkUnit).mockResolvedValue(workUnit);
      vi.mocked(store.createDispatchRecord).mockResolvedValue(dispatchRecord);

      const result = await service.prepareDispatch({
        lifecycleId: "lc-1",
        executableWorkUnitId: "wu-1",
        idempotencyKey: "idem-1",
      });

      expect(result.lifecycle).toEqual(lifecycle);
      expect(result.workUnit).toEqual(workUnit);
      expect(result.dispatchRecord).toEqual({ id: "dispatch-1", attemptNumber: 1 });
      expect(store.createDispatchRecord).toHaveBeenCalledWith({
        executableWorkUnitId: "wu-1",
        attemptNumber: 1,
        idempotencyKey: "idem-1",
      });
    });

    it("throws DispatchAdmissionError when lifecycle not approved", async () => {
      const lifecycle = makeLifecycle({ status: "pending" });
      const workUnit = makeExecutableWorkUnit();

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getExecutableWorkUnit).mockResolvedValue(workUnit);

      await expect(
        service.prepareDispatch({
          lifecycleId: "lc-1",
          executableWorkUnitId: "wu-1",
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow(DispatchAdmissionError);
    });
  });

  describe("recordDispatchOutcome", () => {
    it("updates dispatch record", async () => {
      const dispatchRecord = {
        id: "dispatch-1",
        executableWorkUnitId: "wu-1",
        attemptNumber: 1,
        idempotencyKey: "idem-1",
        state: "succeeded" as const,
        outcome: "success",
        errorMessage: null,
        dispatchedAt: new Date(),
        completedAt: new Date(),
        durationMs: 1000,
      };

      vi.mocked(store.updateDispatchRecord).mockResolvedValue(dispatchRecord);

      await service.recordDispatchOutcome({
        dispatchRecordId: "dispatch-1",
        state: "succeeded",
        outcome: "success",
        durationMs: 1000,
      });

      expect(store.updateDispatchRecord).toHaveBeenCalledWith("dispatch-1", {
        state: "succeeded",
        outcome: "success",
        errorMessage: null,
        completedAt: expect.any(Date),
        durationMs: 1000,
      });
    });
  });

  describe("approveLifecycle", () => {
    it("transitions lifecycle to approved and materializes executable work unit", async () => {
      const lifecycle = makeLifecycle({
        id: "lc-approve",
        actionEnvelopeId: "env-approve-lc",
      });
      const revision = makeRevision({
        id: "rev-approve",
        lifecycleId: "lc-approve",
        parametersSnapshot: { campaignId: "camp-1" },
        approvalScopeSnapshot: { approvers: ["approver-1"], riskCategory: "medium" },
        bindingHash: "hash-approve-lc",
        createdBy: "originator",
      });

      vi.mocked(store.createLifecycleWithRevision).mockResolvedValue({ lifecycle, revision });

      const { lifecycle: createdLifecycle, revision: createdRevision } =
        await service.createGatedLifecycle({
          actionEnvelopeId: "env-approve-lc",
          organizationId: "org-1",
          expiresAt: new Date(Date.now() + 86400000),
          initialRevision: {
            parametersSnapshot: { campaignId: "camp-1" },
            approvalScopeSnapshot: { approvers: ["approver-1"], riskCategory: "medium" },
            bindingHash: "hash-approve-lc",
            createdBy: "originator",
          },
        });

      const mockWorkUnit = makeWorkUnit({
        id: createdLifecycle.actionEnvelopeId,
        organizationId: "org-1",
        intent: "campaign.pause",
        parameters: { campaignId: "camp-1" },
        actor: { id: "originator", type: "user" as const },
        deployment: {
          deploymentId: "dep-1",
          skillSlug: "campaign",
          trustLevel: "supervised" as const,
          trustScore: 0,
        },
        resolvedMode: "skill" as const,
        traceId: "trace-1",
        trigger: "api" as const,
        priority: "normal" as const,
      });

      const approvedLifecycle = makeLifecycle({
        id: "lc-approve",
        actionEnvelopeId: "env-approve-lc",
        status: "approved",
        currentExecutableWorkUnitId: "wu-approved",
      });

      const executableWorkUnit = makeExecutableWorkUnit({
        id: "wu-approved",
        lifecycleId: "lc-approve",
        approvalRevisionId: "rev-approve",
        actionEnvelopeId: "env-approve-lc",
        frozenPayload: {
          parameters: { campaignId: "camp-1" },
          intent: "campaign.pause",
        },
      });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.getCurrentRevision).mockResolvedValue(createdRevision);
      vi.mocked(store.approveAndMaterialize).mockResolvedValue({
        lifecycle: approvedLifecycle,
        workUnit: executableWorkUnit,
      });

      const result = await service.approveLifecycle({
        lifecycleId: createdLifecycle.id,
        respondedBy: "approver-1",
        clientBindingHash: createdRevision.bindingHash,
        workUnit: mockWorkUnit,
        actionEnvelopeId: createdLifecycle.actionEnvelopeId,
        constraints: {},
      });

      expect(result.lifecycle.status).toBe("approved");
      expect(result.executableWorkUnit).toBeDefined();
      expect(result.executableWorkUnit.frozenPayload).toEqual(
        expect.objectContaining({
          parameters: { campaignId: "camp-1" },
          intent: "campaign.pause",
        }),
      );
    });
  });

  describe("rejectLifecycle", () => {
    it("transitions lifecycle to rejected and updates WorkTrace to terminal rejected", async () => {
      const lifecycle = makeLifecycle({
        id: "lc-reject",
        actionEnvelopeId: "env-reject-lc",
      });
      const revision = makeRevision({
        id: "rev-reject",
        lifecycleId: "lc-reject",
        bindingHash: "hash-reject-lc",
      });

      vi.mocked(store.createLifecycleWithRevision).mockResolvedValue({ lifecycle, revision });

      const { lifecycle: createdLifecycle } = await service.createGatedLifecycle({
        actionEnvelopeId: "env-reject-lc",
        organizationId: "org-1",
        expiresAt: new Date(Date.now() + 86400000),
        initialRevision: {
          parametersSnapshot: { campaignId: "camp-1" },
          approvalScopeSnapshot: { approvers: ["approver-1"] },
          bindingHash: "hash-reject-lc",
          createdBy: "originator",
        },
      });

      const rejectedLifecycle = makeLifecycle({
        id: "lc-reject",
        actionEnvelopeId: "env-reject-lc",
        status: "rejected",
      });

      vi.mocked(store.getLifecycleById).mockResolvedValue(lifecycle);
      vi.mocked(store.updateLifecycleStatus).mockResolvedValue(rejectedLifecycle);

      const mockTraceStore = {
        // No existing trace — admission check is skipped (no WorkTrace to verify)
        getByWorkUnitId: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ ok: true as const, trace: {} }),
        persist: vi.fn(),
        getByIdempotencyKey: vi.fn(),
      };

      const result = await service.rejectLifecycle({
        lifecycleId: createdLifecycle.id,
        respondedBy: "approver-1",
        traceStore: mockTraceStore as any,
      });

      expect(result.status).toBe("rejected");
      expect(mockTraceStore.update).toHaveBeenCalledWith(
        lifecycle.actionEnvelopeId,
        expect.objectContaining({
          outcome: "failed",
          approvalOutcome: "rejected",
          approvalRespondedBy: "approver-1",
        }),
      );
    });
  });
});
