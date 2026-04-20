import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOwnerTaskStore } from "../prisma-owner-task-store.js";

const now = new Date("2026-03-25T12:00:00Z");

function makeMockPrisma() {
  return {
    ownerTask: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    organizationId: "org-1",
    contactId: "contact-1",
    opportunityId: "opp-1",
    type: "fallback_handoff",
    title: "Review lead response",
    description: "Agent needs approval for next action",
    suggestedAction: "Send pricing quote",
    status: "pending",
    priority: "medium",
    triggerReason: "Agent confidence below threshold",
    sourceAgent: "employee-a",
    fallbackReason: null,
    dueAt: null,
    completedAt: null,
    createdAt: now,
    ...overrides,
  };
}

describe("PrismaOwnerTaskStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaOwnerTaskStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaOwnerTaskStore(prisma as never);
  });

  describe("create", () => {
    it("creates a new owner task with all fields", async () => {
      const input = {
        organizationId: "org-1",
        contactId: "contact-1",
        opportunityId: "opp-1",
        type: "approval_required" as const,
        title: "Approve discount",
        description: "Customer requesting 20% discount",
        suggestedAction: "Offer 15% instead",
        priority: "high" as const,
        triggerReason: "Discount exceeds agent authority",
        sourceAgent: "employee-b",
        fallbackReason: null,
        dueAt: new Date("2026-03-26T12:00:00Z"),
      };

      const created = makeTask({
        type: "approval_required",
        title: "Approve discount",
        priority: "high",
      });
      prisma.ownerTask.create.mockResolvedValue(created);

      const result = await store.create(input);

      expect(prisma.ownerTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          organizationId: "org-1",
          contactId: "contact-1",
          opportunityId: "opp-1",
          type: "approval_required",
          title: "Approve discount",
          description: "Customer requesting 20% discount",
          suggestedAction: "Offer 15% instead",
          status: "pending",
          priority: "high",
          triggerReason: "Discount exceeds agent authority",
          sourceAgent: "employee-b",
          fallbackReason: null,
          dueAt: new Date("2026-03-26T12:00:00Z"),
          createdAt: expect.any(Date),
        }),
      });

      expect(result.status).toBe("pending");
    });

    it("creates task with minimal fields", async () => {
      const input = {
        organizationId: "org-1",
        type: "manual_action" as const,
        title: "Call customer",
        description: "Customer requested phone call",
        priority: "low" as const,
        triggerReason: "Customer preference",
      };

      const created = makeTask({
        contactId: null,
        opportunityId: null,
        suggestedAction: null,
      });
      prisma.ownerTask.create.mockResolvedValue(created);

      await store.create(input);

      expect(prisma.ownerTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contactId: null,
          opportunityId: null,
          suggestedAction: null,
          fallbackReason: null,
          dueAt: null,
        }),
      });
    });
  });

  describe("findPending", () => {
    it("returns pending tasks sorted by priority and created date", async () => {
      const tasks = [
        makeTask({ id: "task-1", priority: "urgent", createdAt: new Date("2026-03-25T10:00:00Z") }),
        makeTask({ id: "task-2", priority: "high", createdAt: new Date("2026-03-25T09:00:00Z") }),
        makeTask({ id: "task-3", priority: "urgent", createdAt: new Date("2026-03-25T08:00:00Z") }),
        makeTask({ id: "task-4", priority: "medium", createdAt: new Date("2026-03-25T11:00:00Z") }),
      ];
      prisma.ownerTask.findMany.mockResolvedValue(tasks);

      const result = await store.findPending("org-1");

      expect(prisma.ownerTask.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          status: "pending",
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });

      // Verify custom priority sorting: urgent > high > medium
      expect(result).toHaveLength(4);
      expect(result[0]!.id).toBe("task-3"); // urgent, earliest
      expect(result[1]!.id).toBe("task-1"); // urgent, later
      expect(result[2]!.id).toBe("task-2"); // high
      expect(result[3]!.id).toBe("task-4"); // medium
    });

    it("returns empty array when no pending tasks", async () => {
      prisma.ownerTask.findMany.mockResolvedValue([]);

      const result = await store.findPending("org-1");

      expect(result).toEqual([]);
    });

    it("sorts with correct priority order (urgent > high > medium > low)", async () => {
      const tasks = [
        makeTask({ id: "low", priority: "low", createdAt: now }),
        makeTask({ id: "urgent", priority: "urgent", createdAt: now }),
        makeTask({ id: "medium", priority: "medium", createdAt: now }),
        makeTask({ id: "high", priority: "high", createdAt: now }),
      ];
      prisma.ownerTask.findMany.mockResolvedValue(tasks);

      const result = await store.findPending("org-1");

      expect(result[0]!.id).toBe("urgent");
      expect(result[1]!.id).toBe("high");
      expect(result[2]!.id).toBe("medium");
      expect(result[3]!.id).toBe("low");
    });
  });

  describe("updateStatus", () => {
    it("updates task status without completedAt", async () => {
      const existing = makeTask();
      prisma.ownerTask.findFirst.mockResolvedValue(existing);
      const updated = makeTask({ status: "in_progress" });
      prisma.ownerTask.update.mockResolvedValue(updated);

      const result = await store.updateStatus("org-1", "task-1", "in_progress");

      expect(prisma.ownerTask.findFirst).toHaveBeenCalledWith({
        where: { id: "task-1", organizationId: "org-1" },
      });
      expect(prisma.ownerTask.update).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: {
          status: "in_progress",
          completedAt: undefined,
        },
      });
      expect(result.status).toBe("in_progress");
    });

    it("updates task status with completedAt", async () => {
      const existing = makeTask();
      prisma.ownerTask.findFirst.mockResolvedValue(existing);
      const completedDate = new Date("2026-03-25T15:00:00Z");
      const updated = makeTask({
        status: "completed",
        completedAt: completedDate,
      });
      prisma.ownerTask.update.mockResolvedValue(updated);

      const result = await store.updateStatus("org-1", "task-1", "completed", completedDate);

      expect(prisma.ownerTask.findFirst).toHaveBeenCalledWith({
        where: { id: "task-1", organizationId: "org-1" },
      });
      expect(prisma.ownerTask.update).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: {
          status: "completed",
          completedAt: completedDate,
        },
      });
      expect(result.status).toBe("completed");
      expect(result.completedAt).toEqual(completedDate);
    });

    it("updates task to dismissed status", async () => {
      const existing = makeTask();
      prisma.ownerTask.findFirst.mockResolvedValue(existing);
      const updated = makeTask({ status: "dismissed" });
      prisma.ownerTask.update.mockResolvedValue(updated);

      const result = await store.updateStatus("org-1", "task-1", "dismissed");

      expect(result.status).toBe("dismissed");
    });

    it("throws when task not found or wrong org", async () => {
      prisma.ownerTask.findFirst.mockResolvedValue(null);

      await expect(store.updateStatus("org-1", "task-999", "completed")).rejects.toThrow(
        /not found or does not belong/,
      );
    });
  });

  describe("autoComplete", () => {
    it("completes all pending tasks for an opportunity", async () => {
      prisma.ownerTask.updateMany.mockResolvedValue({ count: 3 });

      const count = await store.autoComplete("org-1", "opp-1", "Opportunity won");

      expect(prisma.ownerTask.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          opportunityId: "opp-1",
          status: "pending",
        },
        data: {
          status: "completed",
          completedAt: expect.any(Date),
        },
      });
      expect(count).toBe(3);
    });

    it("returns 0 when no tasks to complete", async () => {
      prisma.ownerTask.updateMany.mockResolvedValue({ count: 0 });

      const count = await store.autoComplete("org-1", "opp-999", "No tasks");

      expect(count).toBe(0);
    });

    it("only completes pending tasks, not in_progress or dismissed", async () => {
      await store.autoComplete("org-1", "opp-1", "Opportunity lost");

      const call = prisma.ownerTask.updateMany.mock.calls[0]?.[0];
      expect(call?.where.status).toBe("pending");
    });
  });

  describe("listOpen", () => {
    it("returns pending tasks with isOverdue flag", async () => {
      const yesterday = new Date(Date.now() - 86_400_000);
      const tomorrow = new Date(Date.now() + 86_400_000);

      prisma.ownerTask.findMany.mockResolvedValue([
        makeTask({ id: "t1", title: "Follow up", priority: "high", dueAt: yesterday }),
        makeTask({ id: "t2", title: "Review pricing", priority: "medium", dueAt: tomorrow }),
        makeTask({ id: "t3", title: "No due date", priority: "low", dueAt: null }),
      ]);
      prisma.ownerTask.count.mockResolvedValue(3);

      const result = await store.listOpen("org-1");

      expect(result).toHaveLength(3);
      expect(result[0]!.isOverdue).toBe(true);
      expect(result[1]!.isOverdue).toBe(false);
      expect(result[2]!.isOverdue).toBe(false);
    });

    it("respects limit parameter", async () => {
      prisma.ownerTask.findMany.mockResolvedValue([]);
      prisma.ownerTask.count.mockResolvedValue(0);
      await store.listOpen("org-1", 5);

      const call = prisma.ownerTask.findMany.mock.calls[0]?.[0];
      expect(call?.take).toBe(5);
    });

    it("provides openCount and overdueCount from separate count queries", async () => {
      const yesterday = new Date(Date.now() - 86_400_000);
      prisma.ownerTask.findMany.mockResolvedValue([
        makeTask({ id: "t1", title: "Overdue", priority: "high", dueAt: yesterday }),
        makeTask({ id: "t2", title: "Not overdue", priority: "medium", dueAt: null }),
      ]);
      prisma.ownerTask.count.mockResolvedValueOnce(20).mockResolvedValueOnce(5);

      const result = await store.listOpen("org-1");
      expect(result.openCount).toBe(20);
      expect(result.overdueCount).toBe(5);
    });

    it("sorts tasks by priority then creation date", async () => {
      const tasks = [
        makeTask({ id: "low", priority: "low", createdAt: new Date("2026-03-25T08:00:00Z") }),
        makeTask({ id: "urgent", priority: "urgent", createdAt: new Date("2026-03-25T10:00:00Z") }),
        makeTask({ id: "medium", priority: "medium", createdAt: new Date("2026-03-25T09:00:00Z") }),
        makeTask({ id: "high", priority: "high", createdAt: new Date("2026-03-25T11:00:00Z") }),
      ];
      prisma.ownerTask.findMany.mockResolvedValue(tasks);
      prisma.ownerTask.count.mockResolvedValue(4);

      const result = await store.listOpen("org-1");

      // Should be sorted: urgent, high, medium, low
      expect(result[0]!.id).toBe("urgent");
      expect(result[1]!.id).toBe("high");
      expect(result[2]!.id).toBe("medium");
      expect(result[3]!.id).toBe("low");
    });

    it("returns correct data shape for each task", async () => {
      const task = makeTask({ id: "t1", title: "Test Task", priority: "high", dueAt: null });
      prisma.ownerTask.findMany.mockResolvedValue([task]);
      prisma.ownerTask.count.mockResolvedValue(1);

      const result = await store.listOpen("org-1");

      expect(result[0]).toMatchObject({
        id: "t1",
        title: "Test Task",
        dueAt: null,
        isOverdue: false,
        status: "pending",
        priority: "high",
      });
    });
  });
});
