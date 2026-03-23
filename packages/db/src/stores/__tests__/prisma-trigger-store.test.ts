import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaTriggerStore } from "../prisma-trigger-store.js";

function createMockPrisma() {
  return {
    scheduledTriggerRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaTriggerStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaTriggerStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaTriggerStore(prisma as never);
  });

  describe("save", () => {
    it("creates a trigger record", async () => {
      const trigger = {
        id: "trig-1",
        organizationId: "org-1",
        type: "timer" as const,
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow" as const, payload: {} },
        sourceWorkflowId: null,
        status: "active" as const,
        createdAt: new Date(),
        expiresAt: null,
      };

      await store.save(trigger);

      expect(prisma.scheduledTriggerRecord.create).toHaveBeenCalledWith({
        data: {
          id: "trig-1",
          organizationId: "org-1",
          type: "timer",
          fireAt: trigger.fireAt,
          cronExpression: null,
          eventPattern: null,
          action: { type: "spawn_workflow", payload: {} },
          sourceWorkflowId: null,
          status: "active",
          createdAt: trigger.createdAt,
          expiresAt: null,
        },
      });
    });
  });

  describe("findById", () => {
    it("returns null when not found", async () => {
      prisma.scheduledTriggerRecord.findUnique.mockResolvedValue(null);
      const result = await store.findById("nonexistent");
      expect(result).toBeNull();
    });

    it("maps Prisma record to ScheduledTrigger", async () => {
      prisma.scheduledTriggerRecord.findUnique.mockResolvedValue({
        id: "trig-1",
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        status: "active",
        createdAt: new Date(),
        expiresAt: null,
      });

      const result = await store.findById("trig-1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("trig-1");
      expect(result!.type).toBe("timer");
    });
  });

  describe("findByFilters", () => {
    it("builds where clause from filters", async () => {
      prisma.scheduledTriggerRecord.findMany.mockResolvedValue([]);
      await store.findByFilters({ organizationId: "org-1", status: "active" });

      expect(prisma.scheduledTriggerRecord.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", status: "active" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("handles empty filters", async () => {
      prisma.scheduledTriggerRecord.findMany.mockResolvedValue([]);
      await store.findByFilters({});

      expect(prisma.scheduledTriggerRecord.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("updateStatus", () => {
    it("updates trigger status", async () => {
      await store.updateStatus("trig-1", "fired");

      expect(prisma.scheduledTriggerRecord.update).toHaveBeenCalledWith({
        where: { id: "trig-1" },
        data: { status: "fired" },
      });
    });
  });

  describe("deleteExpired", () => {
    it("deletes triggers expired before given date", async () => {
      prisma.scheduledTriggerRecord.deleteMany.mockResolvedValue({ count: 3 });
      const before = new Date("2026-03-01T00:00:00Z");
      const count = await store.deleteExpired(before);

      expect(count).toBe(3);
      expect(prisma.scheduledTriggerRecord.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: before },
          status: { in: ["fired", "cancelled", "expired"] },
        },
      });
    });
  });
});
