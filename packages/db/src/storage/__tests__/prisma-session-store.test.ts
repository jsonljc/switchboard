import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaSessionStore } from "../prisma-session-store.js";

function createMockPrisma() {
  return {
    agentSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

describe("PrismaSessionStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaSessionStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client
    store = new PrismaSessionStore(prisma as any);
  });

  describe("update", () => {
    // Issue #594 sibling regression — direct organizationId scoping.
    it("scopes update WHERE by id + organizationId (TI sibling)", async () => {
      prisma.agentSession.updateMany.mockResolvedValue({ count: 1 });

      await store.update("sess_1", { status: "completed" }, "org_1");

      const callArgs = prisma.agentSession.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({ id: "sess_1", organizationId: "org_1" });
    });

    it("throws when update count=0 (tenant mismatch or missing row)", async () => {
      prisma.agentSession.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.update("sess_1", { status: "completed" }, "org_X")).rejects.toThrow(
        /not found or tenant mismatch/,
      );
    });

    it("includes counters + status + checkpoint in data when provided", async () => {
      prisma.agentSession.updateMany.mockResolvedValue({ count: 1 });

      await store.update(
        "sess_1",
        {
          status: "running",
          toolCallCount: 7,
          mutationCount: 3,
          dollarsAtRisk: 250,
          currentStep: 2,
        },
        "org_1",
      );

      const callArgs = prisma.agentSession.updateMany.mock.calls[0]![0];
      expect(callArgs.data).toMatchObject({
        status: "running",
        toolCallCount: 7,
        mutationCount: 3,
        dollarsAtRisk: 250,
        currentStep: 2,
      });
    });
  });
});
