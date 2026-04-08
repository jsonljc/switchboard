import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreativeJobStore } from "../prisma-creative-job-store.js";

function createMockPrisma() {
  return {
    creativeJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaCreativeJobStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCreativeJobStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaCreativeJobStore(prisma as never);
  });

  describe("create", () => {
    it("creates a creative job linked to a task", async () => {
      const input = {
        taskId: "task_1",
        organizationId: "org_1",
        deploymentId: "dep_1",
        productDescription: "AI scheduling tool",
        targetAudience: "Small business owners",
        platforms: ["meta", "youtube"],
        brandVoice: null,
        productImages: [],
        references: [],
        pastPerformance: null,
      };

      const expected = {
        id: "cj_1",
        ...input,
        currentStage: "trends",
        stageOutputs: {},
        stoppedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.creativeJob.create.mockResolvedValue(expected);

      const result = await store.create(input);

      expect(prisma.creativeJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: "task_1",
          productDescription: "AI scheduling tool",
        }),
      });
      expect(result.id).toBe("cj_1");
    });
  });

  describe("findById", () => {
    it("returns job by id", async () => {
      const job = { id: "cj_1", taskId: "task_1" };
      prisma.creativeJob.findUnique.mockResolvedValue(job);

      const result = await store.findById("cj_1");

      expect(result).toEqual(job);
      expect(prisma.creativeJob.findUnique).toHaveBeenCalledWith({
        where: { id: "cj_1" },
      });
    });

    it("returns null when not found", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue(null);

      const result = await store.findById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findByTaskId", () => {
    it("returns job by taskId", async () => {
      const job = { id: "cj_1", taskId: "task_1" };
      prisma.creativeJob.findUnique.mockResolvedValue(job);

      const result = await store.findByTaskId("task_1");

      expect(result).toEqual(job);
      expect(prisma.creativeJob.findUnique).toHaveBeenCalledWith({
        where: { taskId: "task_1" },
      });
    });

    it("returns null when not found", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue(null);

      const result = await store.findByTaskId("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("listByOrg", () => {
    it("lists jobs for an organization", async () => {
      const jobs = [{ id: "cj_1" }, { id: "cj_2" }];
      prisma.creativeJob.findMany.mockResolvedValue(jobs);

      const result = await store.listByOrg("org_1");

      expect(prisma.creativeJob.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_1" },
        take: 50,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });

    it("filters by deploymentId", async () => {
      prisma.creativeJob.findMany.mockResolvedValue([]);

      await store.listByOrg("org_1", { deploymentId: "dep_1" });

      expect(prisma.creativeJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org_1",
            deploymentId: "dep_1",
          }),
        }),
      );
    });

    it("filters by currentStage", async () => {
      prisma.creativeJob.findMany.mockResolvedValue([]);

      await store.listByOrg("org_1", { currentStage: "hooks" });

      expect(prisma.creativeJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org_1",
            currentStage: "hooks",
          }),
        }),
      );
    });

    it("applies limit and offset", async () => {
      prisma.creativeJob.findMany.mockResolvedValue([]);

      await store.listByOrg("org_1", { limit: 10, offset: 5 });

      expect(prisma.creativeJob.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_1" },
        take: 10,
        skip: 5,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("updateStage", () => {
    it("updates current stage and merges stage output", async () => {
      const updated = {
        id: "cj_1",
        currentStage: "hooks",
        stageOutputs: { trends: { angles: [] } },
      };
      prisma.creativeJob.update.mockResolvedValue(updated);

      const result = await store.updateStage("cj_1", "hooks", { trends: { angles: [] } });

      expect(prisma.creativeJob.update).toHaveBeenCalledWith({
        where: { id: "cj_1" },
        data: {
          currentStage: "hooks",
          stageOutputs: { trends: { angles: [] } },
        },
      });
      expect(result.currentStage).toBe("hooks");
    });
  });

  describe("stop", () => {
    it("sets stoppedAt to current stage", async () => {
      const stopped = { id: "cj_1", stoppedAt: "hooks" };
      prisma.creativeJob.update.mockResolvedValue(stopped);

      const result = await store.stop("cj_1", "hooks");

      expect(prisma.creativeJob.update).toHaveBeenCalledWith({
        where: { id: "cj_1" },
        data: { stoppedAt: "hooks" },
      });
      expect(result.stoppedAt).toBe("hooks");
    });
  });
});
