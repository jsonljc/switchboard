import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { PrismaCreativeJobStore } from "../prisma-creative-job-store.js";
import { StaleVersionError } from "@switchboard/core";

function createMockPrisma() {
  return {
    creativeJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
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
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue(updated);

      const result = await store.updateStage("org_1", "cj_1", "hooks", { trends: { angles: [] } });

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: {
          currentStage: "hooks",
          stageOutputs: { trends: { angles: [] } },
          // Forward progress clears any prior terminal marker (replay self-heal).
          stageFailure: Prisma.JsonNull,
        },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect(result.currentStage).toBe("hooks");
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateStage("org_other", "cj_1", "hooks", {})).rejects.toThrow(
        StaleVersionError,
      );
    });
  });

  describe("failPolished", () => {
    it("sets stageFailure on a polished job org-scoped", async () => {
      const failure = { kind: "terminal", code: "ASYNC_JOB_FAILED", message: "boom" };
      const mockResult = { id: "cj_1", stageFailure: failure };
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue(mockResult);

      const result = await store.failPolished("org_1", "cj_1", failure);

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: { stageFailure: failure },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect(result.stageFailure).toEqual(failure);
    });

    it("rejects failPolished on a ugc-mode job", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });

      await expect(store.failPolished("org_1", "cj_1", { code: "X" })).rejects.toThrow(
        "Cannot update polished stage on a UGC-mode job",
      );
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.failPolished("org_other", "cj_1", {})).rejects.toThrow(StaleVersionError);
    });
  });

  describe("stop", () => {
    it("sets stoppedAt to current stage", async () => {
      const stopped = { id: "cj_1", stoppedAt: "hooks" };
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue(stopped);

      const result = await store.stop("org_1", "cj_1", "hooks");

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: { stoppedAt: "hooks" },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect(result.stoppedAt).toBe("hooks");
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.stop("org_other", "cj_1", "hooks")).rejects.toThrow(StaleVersionError);
    });
  });

  describe("updateProductionTier", () => {
    it("updates the productionTier field", async () => {
      const mockJob = { id: "cj_1", productionTier: "pro" };
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue(mockJob);

      const result = await store.updateProductionTier("org_1", "cj_1", "pro");

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: { productionTier: "pro" },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect(result).toEqual(mockJob);
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateProductionTier("org_other", "cj_1", "pro")).rejects.toThrow(
        StaleVersionError,
      );
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
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue(updated);

      const result = await store.updateUgcPhase("org_1", "cj_1", "scripting", {
        planning: { structures: [] },
      });

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: {
          ugcPhase: "scripting",
          ugcPhaseOutputs: { planning: { structures: [] } },
        },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect(result.ugcPhase).toBe("scripting");
    });

    it("rejects update on polished-mode job", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });

      await expect(store.updateUgcPhase("org_1", "cj_1", "scripting", {})).rejects.toThrow(
        "Cannot update UGC phase on a polished-mode job",
      );
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateUgcPhase("org_other", "cj_1", "scripting", {})).rejects.toThrow(
        StaleVersionError,
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
      const mockResult = { id: "cj_1", ugcFailure: error };
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue(mockResult);

      const result = await store.failUgc("org_1", "cj_1", "planning", error);

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: expect.objectContaining({
          ugcFailure: error,
          ugcPhase: "planning",
        }),
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect(result.ugcFailure).toEqual(error);
    });

    it("rejects failUgc on polished-mode job", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });

      await expect(
        store.failUgc("org_1", "cj_1", "planning", {
          kind: "terminal",
          phase: "planning",
          code: "X",
          message: "X",
        }),
      ).rejects.toThrow("Cannot update UGC phase on a polished-mode job");
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        store.failUgc("org_other", "cj_1", "planning", {
          kind: "terminal",
          phase: "planning",
          code: "X",
          message: "X",
        }),
      ).rejects.toThrow(StaleVersionError);
    });
  });

  describe("stopUgc", () => {
    it("stops a UGC job at the given phase", async () => {
      const mockResult = { id: "cj_1", stoppedAt: "scripting", ugcPhase: "scripting" };
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue(mockResult);

      const result = await store.stopUgc("org_1", "cj_1", "scripting");

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: { stoppedAt: "scripting", ugcPhase: "scripting" },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect(result.stoppedAt).toBe("scripting");
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.stopUgc("org_other", "cj_1", "scripting")).rejects.toThrow(
        StaleVersionError,
      );
    });
  });

  describe("mode invariant on updateStage", () => {
    it("rejects updateStage on ugc-mode job", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });

      await expect(store.updateStage("org_1", "cj_1", "hooks", {})).rejects.toThrow(
        "Cannot update polished stage on a UGC-mode job",
      );
    });
  });

  describe("registry methods", () => {
    it("attachIdentityRefs calls updateMany with all identity fields and correct WHERE", async () => {
      const input = {
        productIdentityId: "prod_id_1",
        creatorIdentityId: "creator_id_1",
        effectiveTier: 2,
        allowedOutputTier: 3,
        shotSpecVersion: "v1.0",
        fidelityTierAtGeneration: 2,
      };

      const mockResult = { id: "cj_1", ...input };
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue(mockResult);

      const result = await store.attachIdentityRefs("org_1", "cj_1", input);

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: {
          productIdentityId: "prod_id_1",
          creatorIdentityId: "creator_id_1",
          effectiveTier: 2,
          allowedOutputTier: 3,
          shotSpecVersion: "v1.0",
          fidelityTierAtGeneration: 2,
        },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect(result.id).toBe("cj_1");
    });

    it("attachIdentityRefs throws StaleVersionError when count=0", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        store.attachIdentityRefs("org_other", "cj_1", {
          productIdentityId: "p",
          creatorIdentityId: "c",
          effectiveTier: 1,
          allowedOutputTier: 1,
          shotSpecVersion: "v1",
        }),
      ).rejects.toThrow(StaleVersionError);
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
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue(mockResult);

      const result = await store.markRegistryBackfilled("org_1", "cj_1", input);

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: {
          productIdentityId: "prod_id_1",
          creatorIdentityId: "creator_id_1",
          effectiveTier: 1,
          allowedOutputTier: 1,
          registryBackfilled: true,
          fidelityTierAtGeneration: 1,
        },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect(result.id).toBe("cj_1");
    });

    it("markRegistryBackfilled throws StaleVersionError when count=0", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        store.markRegistryBackfilled("org_other", "cj_1", {
          productIdentityId: "p",
          creatorIdentityId: "c",
        }),
      ).rejects.toThrow(StaleVersionError);
    });
  });

  describe("updatePublishFields", () => {
    it("org-scopes the updateMany and returns the refreshed row", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue({ id: "j1", metaAdId: "ad_1" });

      const row = await store.updatePublishFields("org_1", "j1", {
        metaAdId: "ad_1",
        metaPublishStatus: "parked_paused",
      });

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "j1", organizationId: "org_1" },
        data: { metaAdId: "ad_1", metaPublishStatus: "parked_paused" },
      });
      expect((row as { metaAdId?: string }).metaAdId).toBe("ad_1");
    });

    it("throws when no row matches (cross-org / missing)", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.updatePublishFields("org_1", "j1", { metaVideoId: "v" })).rejects.toThrow(
        StaleVersionError,
      );
    });
  });

  describe("setDurableAsset", () => {
    it("org-scopes the updateMany with durableAssetUrl and returns the refreshed row", async () => {
      const url = "https://cdn.example.com/creative-assets/cj_1/u.mp4";
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue({ id: "cj_1", durableAssetUrl: url });

      const result = await store.setDurableAsset("org_1", "cj_1", url);

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: { durableAssetUrl: url },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect((result as { durableAssetUrl?: string }).durableAssetUrl).toBe(url);
    });

    it("throws StaleVersionError when count=0 (cross-org / missing)", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.setDurableAsset("org_other", "cj_1", "https://x")).rejects.toThrow(
        StaleVersionError,
      );
    });
  });

  describe("completeWithAsset [F13]", () => {
    it("writes the stage flip, stageOutputs, durableAssetUrl, and terminal-clear in ONE updateMany", async () => {
      const url = "https://cdn.example.com/creative-assets/cj_1/u.mp4";
      const outputs = { production: { durableAssetUrl: url } };
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.creativeJob.findFirstOrThrow.mockResolvedValue({
        id: "cj_1",
        currentStage: "complete",
        durableAssetUrl: url,
      });

      const result = await store.completeWithAsset("org_1", "cj_1", "complete", outputs, url);

      // The whole point of F13: a SINGLE row update carries both the completion
      // flag and the durable asset (no second write, no crash window).
      expect(prisma.creativeJob.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: {
          currentStage: "complete",
          stageOutputs: outputs,
          durableAssetUrl: url,
          stageFailure: Prisma.JsonNull,
        },
      });
      expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
      });
      expect((result as { currentStage?: string }).currentStage).toBe("complete");
      expect((result as { durableAssetUrl?: string }).durableAssetUrl).toBe(url);
    });

    it("rejects on a ugc-mode job (polished-only completion path)", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });

      await expect(
        store.completeWithAsset("org_1", "cj_1", "complete", {}, "https://x"),
      ).rejects.toThrow("Cannot update polished stage on a UGC-mode job");
    });

    it("throws StaleVersionError when count=0 (cross-org / missing)", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        store.completeWithAsset("org_other", "cj_1", "complete", {}, "https://x"),
      ).rejects.toThrow(StaleVersionError);
    });
  });
});
