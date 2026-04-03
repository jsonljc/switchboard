import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaPerformanceStore } from "../prisma-performance-store.js";

function makeMockPrisma() {
  return {
    employeePerformanceEvent: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    employeeId: "emp-1",
    organizationId: "org-1",
    contentId: "content-1",
    outcome: "approved",
    feedback: null,
    metrics: { engagement: 0.85, reach: 1200 },
    createdAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

describe("PrismaPerformanceStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaPerformanceStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaPerformanceStore(prisma as never);
  });

  describe("record", () => {
    it("creates a performance event", async () => {
      await store.record("org-1", "emp-1", {
        contentId: "content-1",
        outcome: "approved",
        feedback: "Great work!",
        metrics: { engagement: 0.9 },
      });

      expect(prisma.employeePerformanceEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          employeeId: "emp-1",
          organizationId: "org-1",
          contentId: "content-1",
          outcome: "approved",
          feedback: "Great work!",
          metrics: { engagement: 0.9 },
        }),
      });
    });

    it("defaults feedback and metrics to null", async () => {
      await store.record("org-1", "emp-1", {
        contentId: "content-2",
        outcome: "rejected",
      });

      expect(prisma.employeePerformanceEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          feedback: null,
          metrics: null,
        }),
      });
    });
  });

  describe("getTop", () => {
    it("returns top-performing content with metrics", async () => {
      const rows = [
        makeEventRow(),
        makeEventRow({ id: "evt-2", contentId: "content-2", metrics: { engagement: 0.7 } }),
      ];
      prisma.employeePerformanceEvent.findMany.mockResolvedValue(rows);

      const result = await store.getTop("org-1", "emp-1", "instagram", 5);

      expect(prisma.employeePerformanceEvent.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          employeeId: "emp-1",
          outcome: "approved",
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      expect(result).toHaveLength(2);
      expect(result[0].contentId).toBe("content-1");
    });

    it("filters out events without metrics", async () => {
      const rows = [
        makeEventRow({ metrics: null }),
        makeEventRow({ id: "evt-2", contentId: "content-2" }),
      ];
      prisma.employeePerformanceEvent.findMany.mockResolvedValue(rows);

      const result = await store.getTop("org-1", "emp-1", "instagram", 5);

      expect(result).toHaveLength(1);
      expect(result[0].contentId).toBe("content-2");
    });
  });

  describe("getApprovalRate", () => {
    it("calculates approval rate correctly", async () => {
      prisma.employeePerformanceEvent.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(7); // approved

      const result = await store.getApprovalRate("org-1", "emp-1");

      expect(result).toEqual({ total: 10, approved: 7, rate: 0.7 });
    });

    it("returns zero rate when no events exist", async () => {
      prisma.employeePerformanceEvent.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await store.getApprovalRate("org-1", "emp-1");

      expect(result).toEqual({ total: 0, approved: 0, rate: 0 });
    });

    it("queries with correct filters", async () => {
      prisma.employeePerformanceEvent.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3);

      await store.getApprovalRate("org-1", "emp-1");

      expect(prisma.employeePerformanceEvent.count).toHaveBeenCalledWith({
        where: { organizationId: "org-1", employeeId: "emp-1" },
      });
      expect(prisma.employeePerformanceEvent.count).toHaveBeenCalledWith({
        where: { organizationId: "org-1", employeeId: "emp-1", outcome: "approved" },
      });
    });
  });
});
