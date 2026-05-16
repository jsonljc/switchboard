import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaPauseStore } from "../prisma-pause-store.js";

function createMockPrisma() {
  return {
    agentPause: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe("PrismaPauseStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaPauseStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client
    store = new PrismaPauseStore(prisma as any);
  });

  describe("update", () => {
    // Issue #594 sibling regression — relation-filter for tenant isolation.
    // AgentPause has no direct organizationId; org is derived via session FK.
    it("scopes update WHERE by relation-filter session.organizationId (TI sibling)", async () => {
      prisma.agentPause.updateMany.mockResolvedValue({ count: 1 });

      await store.update("pause_1", { resumeStatus: "consumed" }, "org_1");

      const callArgs = prisma.agentPause.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        id: "pause_1",
        session: { organizationId: "org_1" },
      });
    });

    it("throws when update count=0 (tenant mismatch or missing row)", async () => {
      prisma.agentPause.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.update("pause_1", { resumeStatus: "consumed" }, "org_X")).rejects.toThrow(
        /not found or tenant mismatch/,
      );
    });

    it("includes resumeStatus + approvalOutcome + resumedAt in data when provided", async () => {
      prisma.agentPause.updateMany.mockResolvedValue({ count: 1 });
      const resumedAt = new Date("2025-06-01");

      await store.update(
        "pause_1",
        {
          resumeStatus: "consumed",
          approvalOutcome: { decision: "approved" },
          resumedAt,
        },
        "org_1",
      );

      const callArgs = prisma.agentPause.updateMany.mock.calls[0]![0];
      expect(callArgs.data).toEqual({
        resumeStatus: "consumed",
        approvalOutcome: { decision: "approved" },
        resumedAt,
      });
    });
  });

  describe("compareAndSwapResumeStatus", () => {
    // Issue #594 sibling regression — CAS+orgId scoping via relation filter.
    it("scopes CAS WHERE by id + expectedStatus + relation-filter session.organizationId", async () => {
      prisma.agentPause.updateMany.mockResolvedValue({ count: 1 });

      const result = await store.compareAndSwapResumeStatus(
        "pause_1",
        "pending",
        "consumed",
        "org_1",
      );

      expect(result).toBe(true);
      const callArgs = prisma.agentPause.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        id: "pause_1",
        resumeStatus: "pending",
        session: { organizationId: "org_1" },
      });
    });

    it("returns false on count=0 (status drift, missing row, or tenant mismatch)", async () => {
      prisma.agentPause.updateMany.mockResolvedValue({ count: 0 });

      const result = await store.compareAndSwapResumeStatus(
        "pause_1",
        "pending",
        "consumed",
        "org_X",
      );

      expect(result).toBe(false);
    });
  });
});
