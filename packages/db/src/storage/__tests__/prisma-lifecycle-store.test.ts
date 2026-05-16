import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaLifecycleStore } from "../prisma-lifecycle-store.js";
import { StaleVersionError } from "@switchboard/core";
import type { MaterializeWorkUnitInput } from "@switchboard/core/approval";

function createMockPrisma() {
  return {
    approvalLifecycle: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    approvalRevision: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    executableWorkUnit: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

const LIFECYCLE_DB_ROW = {
  id: "lc_1",
  actionEnvelopeId: "env_1",
  organizationId: "org_1",
  status: "approved",
  currentRevisionId: "rev_1",
  currentExecutableWorkUnitId: "wu_1",
  expiresAt: new Date("2025-12-31"),
  pausedSessionId: null,
  version: 2,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-06-01"),
};

const MATERIALIZE_INPUT: MaterializeWorkUnitInput = {
  lifecycleId: "lc_1",
  approvalRevisionId: "rev_1",
  actionEnvelopeId: "env_1",
  frozenPayload: { foo: "bar" },
  frozenBinding: {},
  frozenExecutionPolicy: {},
  executableUntil: new Date("2025-12-31"),
};

describe("PrismaLifecycleStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaLifecycleStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client for testing
    store = new PrismaLifecycleStore(prisma as any);
  });

  describe("updateLifecycleStatus", () => {
    // TI-8 regression — cross-tenant isolation on optimistic updateMany WHERE.
    // Audit: docs/audits/2026-05-15-cleanup/security-sweep-delta.md (TI-8 STILL-OPEN).
    it("scopes updateMany WHERE by organizationId (TI-8)", async () => {
      prisma.approvalLifecycle.updateMany.mockResolvedValue({ count: 1 });
      prisma.approvalLifecycle.findUniqueOrThrow.mockResolvedValue(LIFECYCLE_DB_ROW);

      await store.updateLifecycleStatus("lc_1", "rejected", 1, "org_1");

      const callArgs = prisma.approvalLifecycle.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        id: "lc_1",
        version: 1,
        organizationId: "org_1",
      });
    });

    it("scopes updateMany WHERE by organizationId=null when caller passes null", async () => {
      prisma.approvalLifecycle.updateMany.mockResolvedValue({ count: 1 });
      prisma.approvalLifecycle.findUniqueOrThrow.mockResolvedValue({
        ...LIFECYCLE_DB_ROW,
        organizationId: null,
      });

      await store.updateLifecycleStatus("lc_1", "rejected", 1, null);

      const callArgs = prisma.approvalLifecycle.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        id: "lc_1",
        version: 1,
        organizationId: null,
      });
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.approvalLifecycle.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateLifecycleStatus("lc_1", "rejected", 1, "org_1")).rejects.toThrow(
        StaleVersionError,
      );
    });

    it("includes status updates in the data clause", async () => {
      prisma.approvalLifecycle.updateMany.mockResolvedValue({ count: 1 });
      prisma.approvalLifecycle.findUniqueOrThrow.mockResolvedValue(LIFECYCLE_DB_ROW);

      await store.updateLifecycleStatus("lc_1", "rejected", 1, "org_1", {
        currentExecutableWorkUnitId: "wu_new",
      });

      const callArgs = prisma.approvalLifecycle.updateMany.mock.calls[0]![0];
      expect(callArgs.data).toMatchObject({
        status: "rejected",
        version: 2,
        currentExecutableWorkUnitId: "wu_new",
      });
    });
  });

  describe("approveAndMaterialize", () => {
    // TI-8 regression — cross-tenant isolation on optimistic updateMany inside transaction.
    // Audit: docs/audits/2026-05-15-cleanup/security-sweep-delta.md (TI-8 STILL-OPEN).
    it("scopes transaction updateMany WHERE by organizationId (TI-8)", async () => {
      const fakeWorkUnitRow = {
        id: "wu_new",
        lifecycleId: "lc_1",
        approvalRevisionId: "rev_1",
        actionEnvelopeId: "env_1",
        frozenPayload: { foo: "bar" },
        frozenBinding: {},
        frozenExecutionPolicy: {},
        executableUntil: new Date("2025-12-31"),
        createdAt: new Date("2025-06-01"),
      };

      prisma.approvalLifecycle.updateMany.mockReturnValue({});
      prisma.executableWorkUnit.create.mockReturnValue({});
      prisma.$transaction.mockResolvedValue([{ count: 1 }, fakeWorkUnitRow]);
      prisma.approvalLifecycle.findUniqueOrThrow.mockResolvedValue(LIFECYCLE_DB_ROW);

      await store.approveAndMaterialize("lc_1", 1, "org_1", MATERIALIZE_INPUT);

      const callArgs = prisma.approvalLifecycle.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        id: "lc_1",
        version: 1,
        organizationId: "org_1",
      });
    });

    it("scopes transaction updateMany WHERE by organizationId=null when caller passes null", async () => {
      const fakeWorkUnitRow = {
        id: "wu_new",
        lifecycleId: "lc_1",
        approvalRevisionId: "rev_1",
        actionEnvelopeId: "env_1",
        frozenPayload: { foo: "bar" },
        frozenBinding: {},
        frozenExecutionPolicy: {},
        executableUntil: new Date("2025-12-31"),
        createdAt: new Date("2025-06-01"),
      };

      prisma.approvalLifecycle.updateMany.mockReturnValue({});
      prisma.executableWorkUnit.create.mockReturnValue({});
      prisma.$transaction.mockResolvedValue([{ count: 1 }, fakeWorkUnitRow]);
      prisma.approvalLifecycle.findUniqueOrThrow.mockResolvedValue({
        ...LIFECYCLE_DB_ROW,
        organizationId: null,
      });

      await store.approveAndMaterialize("lc_1", 1, null, MATERIALIZE_INPUT);

      const callArgs = prisma.approvalLifecycle.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        id: "lc_1",
        version: 1,
        organizationId: null,
      });
    });

    it("throws StaleVersionError when transaction updateMany count=0", async () => {
      prisma.approvalLifecycle.updateMany.mockReturnValue({});
      prisma.executableWorkUnit.create.mockReturnValue({});
      prisma.$transaction.mockResolvedValue([{ count: 0 }, {}]);

      await expect(
        store.approveAndMaterialize("lc_1", 1, "org_1", MATERIALIZE_INPUT),
      ).rejects.toThrow(StaleVersionError);
    });
  });

  describe("createRevision", () => {
    const REVISION_INPUT = {
      lifecycleId: "lc_1",
      organizationId: "org_1" as string | null,
      parametersSnapshot: { foo: "bar" },
      approvalScopeSnapshot: { risk: "medium" },
      bindingHash: "hash-new",
      rationale: null,
      supersedesRevisionId: "rev_old",
      createdBy: "user_1",
    };

    const FAKE_REVISION_ROW = {
      id: "rev_new",
      lifecycleId: "lc_1",
      revisionNumber: 2,
      parametersSnapshot: { foo: "bar" },
      approvalScopeSnapshot: { risk: "medium" },
      bindingHash: "hash-new",
      rationale: null,
      supersedesRevisionId: "rev_old",
      createdBy: "user_1",
      createdAt: new Date("2025-06-01"),
    };

    // Issue #594 sibling regression — orgId scoping on lifecycle pointer update
    // inside the createRevision transaction.
    it("scopes lifecycle updateMany WHERE by organizationId (TI sibling)", async () => {
      prisma.approvalRevision.findFirst.mockResolvedValue({ revisionNumber: 1 });
      prisma.approvalRevision.create.mockReturnValue({});
      prisma.approvalLifecycle.updateMany.mockReturnValue({});
      prisma.$transaction.mockResolvedValue([FAKE_REVISION_ROW, { count: 1 }]);

      await store.createRevision(REVISION_INPUT);

      const callArgs = prisma.approvalLifecycle.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({ id: "lc_1", organizationId: "org_1" });
    });

    it("scopes lifecycle updateMany WHERE by organizationId=null when input is null", async () => {
      prisma.approvalRevision.findFirst.mockResolvedValue({ revisionNumber: 1 });
      prisma.approvalRevision.create.mockReturnValue({});
      prisma.approvalLifecycle.updateMany.mockReturnValue({});
      prisma.$transaction.mockResolvedValue([FAKE_REVISION_ROW, { count: 1 }]);

      await store.createRevision({ ...REVISION_INPUT, organizationId: null });

      const callArgs = prisma.approvalLifecycle.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({ id: "lc_1", organizationId: null });
    });

    it("throws when transaction lifecycle updateMany count=0 (tenant mismatch)", async () => {
      prisma.approvalRevision.findFirst.mockResolvedValue({ revisionNumber: 1 });
      prisma.approvalRevision.create.mockReturnValue({});
      prisma.approvalLifecycle.updateMany.mockReturnValue({});
      prisma.$transaction.mockResolvedValue([FAKE_REVISION_ROW, { count: 0 }]);

      await expect(store.createRevision(REVISION_INPUT)).rejects.toThrow(
        /not found or tenant mismatch/,
      );
    });

    it("returns the created revision when transaction succeeds", async () => {
      prisma.approvalRevision.findFirst.mockResolvedValue({ revisionNumber: 1 });
      prisma.approvalRevision.create.mockReturnValue({});
      prisma.approvalLifecycle.updateMany.mockReturnValue({});
      prisma.$transaction.mockResolvedValue([FAKE_REVISION_ROW, { count: 1 }]);

      const result = await store.createRevision(REVISION_INPUT);

      expect(result.id).toBe("rev_new");
      expect(result.revisionNumber).toBe(2);
      expect(result.bindingHash).toBe("hash-new");
    });
  });
});
