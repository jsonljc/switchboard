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
        generateReferenceImages: false,
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
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });
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

  describe("updateProductionTier", () => {
    it("updates the productionTier field", async () => {
      const mockJob = { id: "cj_1", productionTier: "pro" };
      prisma.creativeJob.update.mockResolvedValue(mockJob);

      const result = await store.updateProductionTier("cj_1", "pro");

      expect(prisma.creativeJob.update).toHaveBeenCalledWith({
        where: { id: "cj_1" },
        data: { productionTier: "pro" },
      });
      expect(result).toEqual(mockJob);
    });
  });

  describe("createUgc", () => {
    it("creates a UGC job with mode='ugc' and initial ugcPhase", async () => {
      const input = {
        taskId: "task_1",
        organizationId: "org_1",
        deploymentId: "dep_1",
        productDescription: "AI scheduling tool",
        targetAudience: "Small business owners",
        platforms: ["meta"],
        brandVoice: null,
        productImages: [],
        references: [],
        pastPerformance: null,
        generateReferenceImages: false,
        ugcConfig: { brief: { creatorPoolIds: ["c1"], ugcFormat: "talking_head" } },
      };

      const expected = {
        id: "cj_ugc_1",
        ...input,
        mode: "ugc",
        ugcPhase: "planning",
        ugcPhaseOutputs: {},
        ugcPhaseOutputsVersion: "v1",
        ugcConfig: input.ugcConfig,
        ugcFailure: null,
        currentStage: "trends",
        stageOutputs: {},
        stoppedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.creativeJob.create.mockResolvedValue(expected);

      const result = await store.createUgc(input);

      expect(prisma.creativeJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mode: "ugc",
          ugcPhase: "planning",
          ugcConfig: input.ugcConfig,
        }),
      });
      expect(result.mode).toBe("ugc");
    });
  });

  describe("updateUgcPhase", () => {
    it("updates ugcPhase and ugcPhaseOutputs", async () => {
      const updated = {
        id: "cj_1",
        mode: "ugc",
        ugcPhase: "scripting",
        ugcPhaseOutputs: { planning: { structures: [] } },
      };
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
      prisma.creativeJob.update.mockResolvedValue(updated);

      const result = await store.updateUgcPhase("cj_1", "scripting", {
        planning: { structures: [] },
      });

      expect(result.ugcPhase).toBe("scripting");
    });

    it("rejects update on polished-mode job", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });

      await expect(store.updateUgcPhase("cj_1", "scripting", {})).rejects.toThrow(
        "Cannot update UGC phase on a polished-mode job",
      );
    });
  });

  describe("failUgc", () => {
    it("sets ugcFailure on the job", async () => {
      const error = {
        kind: "terminal",
        phase: "planning",
        code: "NO_ELIGIBLE_CREATORS",
        message: "No creators",
      };
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
      prisma.creativeJob.update.mockResolvedValue({ id: "cj_1", ugcFailure: error });

      const result = await store.failUgc("cj_1", "planning", error);

      expect(prisma.creativeJob.update).toHaveBeenCalledWith({
        where: { id: "cj_1" },
        data: expect.objectContaining({
          ugcFailure: error,
          ugcPhase: "planning",
        }),
      });
      expect(result.ugcFailure).toEqual(error);
    });

    it("rejects failUgc on polished-mode job", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });

      await expect(
        store.failUgc("cj_1", "planning", {
          kind: "terminal",
          phase: "planning",
          code: "X",
          message: "X",
        }),
      ).rejects.toThrow("Cannot update UGC phase on a polished-mode job");
    });
  });

  describe("stopUgc", () => {
    it("stops a UGC job at the given phase", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
      prisma.creativeJob.update.mockResolvedValue({
        id: "cj_1",
        stoppedAt: "scripting",
        ugcPhase: "scripting",
      });

      const result = await store.stopUgc("cj_1", "scripting");

      expect(prisma.creativeJob.update).toHaveBeenCalledWith({
        where: { id: "cj_1" },
        data: { stoppedAt: "scripting", ugcPhase: "scripting" },
      });
      expect(result.stoppedAt).toBe("scripting");
    });
  });

  describe("mode invariant on updateStage", () => {
    it("rejects updateStage on ugc-mode job", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });

      await expect(store.updateStage("cj_1", "hooks", {})).rejects.toThrow(
        "Cannot update polished stage on a UGC-mode job",
      );
    });
  });

  describe("stageProgressByApproval", () => {
    it("returns an empty Map and emits a console.warn when called with non-empty ids (no ApprovalRecord ↔ CreativeJob bridge in current schema — Path B per option-C1 plan)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const result = await store.stageProgressByApproval(["any-id"]);
        expect(result.size).toBe(0);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0]![0]).toContain("stageProgressByApproval");
        expect(warnSpy.mock.calls[0]![0]).toContain("1 approval IDs");
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("returns an empty Map silently for an empty input array", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const result = await store.stageProgressByApproval([]);
        expect(result.size).toBe(0);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("registry methods", () => {
    it("attachIdentityRefs calls update with all identity fields", async () => {
      const input = {
        productIdentityId: "prod_id_1",
        creatorIdentityId: "creator_id_1",
        effectiveTier: 2,
        allowedOutputTier: 3,
        shotSpecVersion: "v1.0",
        fidelityTierAtGeneration: 2,
      };

      const mockResult = { id: "cj_1", ...input };
      prisma.creativeJob.update.mockResolvedValue(mockResult);

      const result = await store.attachIdentityRefs("cj_1", input);

      expect(prisma.creativeJob.update).toHaveBeenCalledWith({
        where: { id: "cj_1" },
        data: {
          productIdentityId: "prod_id_1",
          creatorIdentityId: "creator_id_1",
          effectiveTier: 2,
          allowedOutputTier: 3,
          shotSpecVersion: "v1.0",
          fidelityTierAtGeneration: 2,
        },
      });
      expect(result.id).toBe("cj_1");
    });

    it("markRegistryBackfilled sets fixed tiers and backfilled flag", async () => {
      const input = {
        productIdentityId: "prod_id_1",
        creatorIdentityId: "creator_id_1",
      };

      const mockResult = {
        id: "cj_1",
        productIdentityId: "prod_id_1",
        creatorIdentityId: "creator_id_1",
        effectiveTier: 1,
        allowedOutputTier: 1,
        registryBackfilled: true,
        fidelityTierAtGeneration: 1,
      };
      prisma.creativeJob.update.mockResolvedValue(mockResult);

      const result = await store.markRegistryBackfilled("cj_1", input);

      expect(prisma.creativeJob.update).toHaveBeenCalledWith({
        where: { id: "cj_1" },
        data: {
          productIdentityId: "prod_id_1",
          creatorIdentityId: "creator_id_1",
          effectiveTier: 1,
          allowedOutputTier: 1,
          registryBackfilled: true,
          fidelityTierAtGeneration: 1,
        },
      });
      expect(result.id).toBe("cj_1");
    });
  });
});
