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
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

describe("PrismaExecutionTraceStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaExecutionTraceStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaExecutionTraceStore(prisma);
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

  describe("linkOutcome", () => {
    it("updates trace with outcome", async () => {
      await store.linkOutcome("trace-1", {
        id: "opp-1",
        type: "opportunity",
        result: "stage_qualified",
      });
      expect(prisma.executionTrace.update).toHaveBeenCalledWith({
        where: { id: "trace-1" },
        data: {
          linkedOutcomeId: "opp-1",
          linkedOutcomeType: "opportunity",
          linkedOutcomeResult: "stage_qualified",
        },
      });
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
