import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRunStore } from "../prisma-run-store.js";

function createMockPrisma() {
  return {
    agentRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe("PrismaRunStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaRunStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client
    store = new PrismaRunStore(prisma as any);
  });

  describe("update", () => {
    // Issue #594 sibling regression — relation-filter for tenant isolation.
    // AgentRun has no direct organizationId; org is derived via session FK.
    it("scopes update WHERE by relation-filter session.organizationId (TI sibling)", async () => {
      prisma.agentRun.updateMany.mockResolvedValue({ count: 1 });

      await store.update("run_1", { outcome: "completed" }, "org_1");

      const callArgs = prisma.agentRun.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        id: "run_1",
        session: { organizationId: "org_1" },
      });
    });

    it("throws when update count=0 (tenant mismatch or missing row)", async () => {
      prisma.agentRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.update("run_1", { outcome: "completed" }, "org_X")).rejects.toThrow(
        /not found or tenant mismatch/,
      );
    });

    it("includes outcome + stepRange + completedAt in data when provided", async () => {
      prisma.agentRun.updateMany.mockResolvedValue({ count: 1 });
      const completedAt = new Date("2025-06-01");

      await store.update(
        "run_1",
        {
          outcome: "completed",
          stepRange: { start: 0, end: 5 },
          completedAt,
        },
        "org_1",
      );

      const callArgs = prisma.agentRun.updateMany.mock.calls[0]![0];
      expect(callArgs.data).toEqual({
        outcome: "completed",
        stepRange: { start: 0, end: 5 },
        completedAt,
      });
    });
  });
});
