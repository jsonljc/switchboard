import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaExecutionTraceStore } from "../prisma-execution-trace-store.js";

function makeTrace(overrides: Record<string, unknown> = {}) {
  return {
    id: "trace-1",
    deploymentId: "d1",
    organizationId: "org1",
    skillSlug: "sales-pipeline",
    skillVersion: "1.0.0",
    trigger: "chat_message" as const,
    sessionId: "session-1",
    inputParametersHash: "abc123",
    toolCalls: [],
    governanceDecisions: [],
    tokenUsage: { input: 100, output: 50 },
    durationMs: 1500,
    turnCount: 2,
    status: "success" as const,
    responseSummary: "Qualified lead, moved to quoted stage",
    writeCount: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

function makePrisma() {
  return {
    executionTrace: {
      create: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

describe("PrismaExecutionTraceStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaExecutionTraceStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaExecutionTraceStore(prisma as never);
  });

  describe("create", () => {
    it("persists a trace", async () => {
      const trace = makeTrace();
      await store.create(trace);
      expect(prisma.executionTrace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "trace-1",
          deploymentId: "d1",
          skillSlug: "sales-pipeline",
          status: "success",
        }),
      });
    });

    it("persists linked outcome fields when present", async () => {
      const trace = makeTrace({
        linkedOutcomeId: "bk_1",
        linkedOutcomeType: "booking",
        linkedOutcomeResult: "booked",
      });
      await store.create(trace);
      expect(prisma.executionTrace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linkedOutcomeId: "bk_1",
          linkedOutcomeType: "booking",
          linkedOutcomeResult: "booked",
        }),
      });
    });

    it("persists the workUnitId lineage link when present", async () => {
      const trace = makeTrace({ workUnitId: "wu_42" });
      await store.create(trace);
      expect(prisma.executionTrace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ workUnitId: "wu_42" }),
      });
    });
  });

  describe("listByDeployment", () => {
    it("queries by orgId and deploymentId", async () => {
      prisma.executionTrace.findMany.mockResolvedValue([makeTrace()]);
      const result = await store.listByDeployment("org1", "d1", { limit: 10 });
      expect(prisma.executionTrace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org1", deploymentId: "d1" },
          orderBy: { createdAt: "desc" },
          take: 11,
        }),
      );
      expect(result.traces).toHaveLength(1);
    });

    it("returns nextCursor when more results exist", async () => {
      const traces = Array.from({ length: 11 }, (_, i) =>
        makeTrace({ id: `trace-${i}`, createdAt: new Date(2026, 0, i + 1) }),
      );
      prisma.executionTrace.findMany.mockResolvedValue(traces);
      const result = await store.listByDeployment("org1", "d1", { limit: 10 });
      expect(result.traces).toHaveLength(10);
      expect(result.nextCursor).toBe("trace-9");
    });
  });

  describe("findById", () => {
    it("returns trace when found", async () => {
      const trace = makeTrace();
      prisma.executionTrace.findFirst.mockResolvedValue(trace);
      const result = await store.findById("org1", "trace-1");
      expect(result).toEqual(trace);
      expect(prisma.executionTrace.findFirst).toHaveBeenCalledWith({
        where: { id: "trace-1", organizationId: "org1" },
      });
    });

    it("returns null when not found", async () => {
      const result = await store.findById("org1", "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("findByWorkUnitId", () => {
    it("returns the work unit's traces ordered chronologically, tenant-scoped", async () => {
      const traces = [
        makeTrace({ id: "t-a", workUnitId: "wu_9", createdAt: new Date(2026, 0, 1) }),
        makeTrace({ id: "t-b", workUnitId: "wu_9", createdAt: new Date(2026, 0, 2) }),
      ];
      prisma.executionTrace.findMany.mockResolvedValue(traces);
      const result = await store.findByWorkUnitId("org1", "wu_9");
      expect(prisma.executionTrace.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org1", workUnitId: "wu_9" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("t-a");
      // each row exposes its ordered tool-call sequence
      expect(Array.isArray(result[0]!.toolCalls)).toBe(true);
    });

    it("returns an empty array when no traces match", async () => {
      prisma.executionTrace.findMany.mockResolvedValue([]);
      const result = await store.findByWorkUnitId("org1", "wu_none");
      expect(result).toEqual([]);
    });
  });

  describe("linkOutcome", () => {
    it("updates trace with outcome using tenant-scoped updateMany", async () => {
      await store.linkOutcome("org_1", "trace-1", {
        id: "opp-1",
        type: "opportunity",
        result: "stage_qualified",
      });
      expect(prisma.executionTrace.updateMany).toHaveBeenCalledWith({
        where: { id: "trace-1", organizationId: "org_1" },
        data: {
          linkedOutcomeId: "opp-1",
          linkedOutcomeType: "opportunity",
          linkedOutcomeResult: "stage_qualified",
        },
      });
    });

    it("throws StaleVersionError when updateMany count === 0", async () => {
      prisma.executionTrace.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        store.linkOutcome("org_1", "trace-missing", {
          id: "opp-1",
          type: "opportunity",
          result: "stage_qualified",
        }),
      ).rejects.toThrow(/Stale version/);
    });
  });

  describe("countRecentFailures", () => {
    it("counts traces with error/budget_exceeded status in window", async () => {
      prisma.executionTrace.count.mockResolvedValue(3);
      const result = await store.countRecentFailures("d1", 3_600_000);
      expect(result).toBe(3);
      expect(prisma.executionTrace.count).toHaveBeenCalledWith({
        where: {
          deploymentId: "d1",
          status: { in: ["error", "budget_exceeded"] },
          createdAt: { gte: expect.any(Date) },
        },
      });
    });
  });

  describe("countWritesInWindow", () => {
    it("sums writeCount for traces in window", async () => {
      prisma.executionTrace.findMany.mockResolvedValue([
        makeTrace({ writeCount: 3 }),
        makeTrace({ writeCount: 7 }),
      ]);
      const result = await store.countWritesInWindow("d1", 3_600_000);
      expect(result).toBe(10);
    });
  });
});
