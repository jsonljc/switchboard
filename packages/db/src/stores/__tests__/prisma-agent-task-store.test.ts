import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAgentTaskStore } from "../prisma-agent-task-store.js";

function createMockPrisma() {
  return {
    agentTask: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaAgentTaskStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaAgentTaskStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaAgentTaskStore(prisma as never);
  });

  describe("create", () => {
    it("creates a task with all fields", async () => {
      const input = {
        deploymentId: "dep-1",
        organizationId: "org-1",
        listingId: "lst-1",
        category: "email",
        input: { to: "test@example.com", subject: "Hello" },
        acceptanceCriteria: "Email should be sent successfully",
      };
      prisma.agentTask.create.mockResolvedValue({
        id: "task_1",
        ...input,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await store.create(input);

      expect(prisma.agentTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deploymentId: "dep-1",
          organizationId: "org-1",
          listingId: "lst-1",
          category: "email",
          input: { to: "test@example.com", subject: "Hello" },
          acceptanceCriteria: "Email should be sent successfully",
        }),
      });
      expect(result.id).toBe("task_1");
    });

    it("creates task with minimal required fields", async () => {
      const input = {
        deploymentId: "dep-1",
        organizationId: "org-1",
        listingId: "lst-1",
        category: "general",
      };
      prisma.agentTask.create.mockResolvedValue({
        id: "task_2",
        ...input,
        status: "pending",
        input: null,
        acceptanceCriteria: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await store.create(input);

      expect(prisma.agentTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          acceptanceCriteria: null,
        }),
      });
    });
  });

  describe("findById", () => {
    it("returns null when task not found", async () => {
      prisma.agentTask.findUnique.mockResolvedValue(null);

      const result = await store.findById("task_999");

      expect(result).toBeNull();
      expect(prisma.agentTask.findUnique).toHaveBeenCalledWith({ where: { id: "task_999" } });
    });

    it("returns task when found", async () => {
      prisma.agentTask.findUnique.mockResolvedValue({
        id: "task_1",
        category: "email",
        status: "pending",
      });

      const result = await store.findById("task_1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("task_1");
      expect(result?.category).toBe("email");
    });
  });

  describe("listByDeployment", () => {
    it("lists all tasks for deployment", async () => {
      prisma.agentTask.findMany.mockResolvedValue([
        { id: "task_1", deploymentId: "dep-1" },
        { id: "task_2", deploymentId: "dep-1" },
      ]);

      const result = await store.listByDeployment("dep-1");

      expect(prisma.agentTask.findMany).toHaveBeenCalledWith({
        where: { deploymentId: "dep-1" },
        take: 50,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });

    it("filters by status", async () => {
      prisma.agentTask.findMany.mockResolvedValue([]);

      await store.listByDeployment("dep-1", { status: "completed" });

      expect(prisma.agentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deploymentId: "dep-1", status: "completed" },
        }),
      );
    });

    it("filters by category", async () => {
      prisma.agentTask.findMany.mockResolvedValue([]);

      await store.listByDeployment("dep-1", { category: "email" });

      expect(prisma.agentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deploymentId: "dep-1", category: "email" },
        }),
      );
    });

    it("applies limit and offset", async () => {
      prisma.agentTask.findMany.mockResolvedValue([]);

      await store.listByDeployment("dep-1", { limit: 10, offset: 5 });

      expect(prisma.agentTask.findMany).toHaveBeenCalledWith({
        where: { deploymentId: "dep-1" },
        take: 10,
        skip: 5,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("listByOrg", () => {
    it("lists all tasks for organization", async () => {
      prisma.agentTask.findMany.mockResolvedValue([
        { id: "task_1", organizationId: "org-1" },
        { id: "task_2", organizationId: "org-1" },
      ]);

      const result = await store.listByOrg("org-1");

      expect(prisma.agentTask.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        take: 50,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });

    it("filters by status", async () => {
      prisma.agentTask.findMany.mockResolvedValue([]);

      await store.listByOrg("org-1", { status: "awaiting_review" });

      expect(prisma.agentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org-1", status: "awaiting_review" },
        }),
      );
    });
  });

  describe("updateStatus", () => {
    it("updates task status", async () => {
      prisma.agentTask.update.mockResolvedValue({
        id: "task_1",
        status: "running",
      });

      const result = await store.updateStatus("task_1", "running");

      expect(prisma.agentTask.update).toHaveBeenCalledWith({
        where: { id: "task_1" },
        data: { status: "running" },
      });
      expect(result.status).toBe("running");
    });
  });

  describe("submitOutput", () => {
    it("submits task output and sets status to awaiting_review", async () => {
      const output = { result: "Email sent successfully" };
      prisma.agentTask.update.mockResolvedValue({
        id: "task_1",
        status: "awaiting_review",
        output,
        completedAt: expect.any(Date),
      });

      const result = await store.submitOutput("task_1", output);

      expect(prisma.agentTask.update).toHaveBeenCalledWith({
        where: { id: "task_1" },
        data: {
          output,
          status: "awaiting_review",
          completedAt: expect.any(Date),
        },
      });
      expect(result.status).toBe("awaiting_review");
    });
  });

  describe("review", () => {
    it("approves a task", async () => {
      prisma.agentTask.update.mockResolvedValue({
        id: "task_1",
        status: "approved",
        reviewedBy: "user-1",
        reviewedAt: expect.any(Date),
        reviewResult: "Good work",
      });

      const result = await store.review("task_1", "approved", "user-1", "Good work");

      expect(prisma.agentTask.update).toHaveBeenCalledWith({
        where: { id: "task_1" },
        data: {
          status: "approved",
          reviewedBy: "user-1",
          reviewedAt: expect.any(Date),
          reviewResult: "Good work",
        },
      });
      expect(result.status).toBe("approved");
    });

    it("rejects a task without review result", async () => {
      prisma.agentTask.update.mockResolvedValue({
        id: "task_1",
        status: "rejected",
        reviewedBy: "user-1",
        reviewedAt: expect.any(Date),
        reviewResult: null,
      });

      await store.review("task_1", "rejected", "user-1");

      expect(prisma.agentTask.update).toHaveBeenCalledWith({
        where: { id: "task_1" },
        data: {
          status: "rejected",
          reviewedBy: "user-1",
          reviewedAt: expect.any(Date),
          reviewResult: null,
        },
      });
    });
  });
});
