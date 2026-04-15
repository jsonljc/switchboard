import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAssetRecordStore } from "../prisma-asset-record-store.js";

function createMockPrisma() {
  return {
    assetRecord: {
      create: vi.fn(),
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaAssetRecordStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaAssetRecordStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaAssetRecordStore(prisma as never);
  });

  describe("upsertByKey", () => {
    it("upserts asset by specId + attemptNumber + provider", async () => {
      const input = {
        jobId: "job_1",
        specId: "spec_1",
        creatorId: "cr_1",
        provider: "kling",
        modelId: "kling-v1",
        attemptNumber: 1,
        inputHashes: { referencesHash: "abc", promptHash: "def" },
        outputs: { videoUrl: "https://cdn.example.com/v.mp4", checksums: {} },
        approvalState: "pending" as const,
      };

      const expected = { id: "ar_1", ...input, createdAt: new Date() };
      prisma.assetRecord.upsert.mockResolvedValue(expected);

      const result = await store.upsertByKey(input);

      expect(prisma.assetRecord.upsert).toHaveBeenCalledWith({
        where: {
          specId_attemptNumber_provider: {
            specId: "spec_1",
            attemptNumber: 1,
            provider: "kling",
          },
        },
        create: expect.objectContaining({ jobId: "job_1", specId: "spec_1" }),
        update: expect.objectContaining({ outputs: input.outputs }),
      });
      expect(result.id).toBe("ar_1");
    });
  });

  describe("findByJob", () => {
    it("returns assets for a job", async () => {
      const assets = [{ id: "ar_1" }, { id: "ar_2" }];
      prisma.assetRecord.findMany.mockResolvedValue(assets);

      const result = await store.findByJob("job_1");

      expect(prisma.assetRecord.findMany).toHaveBeenCalledWith({
        where: { jobId: "job_1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("findBySpec", () => {
    it("returns assets for a spec", async () => {
      prisma.assetRecord.findMany.mockResolvedValue([{ id: "ar_1" }]);

      const result = await store.findBySpec("spec_1");

      expect(prisma.assetRecord.findMany).toHaveBeenCalledWith({
        where: { specId: "spec_1" },
        orderBy: { attemptNumber: "asc" },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("findLockedByCreator", () => {
    it("returns the most recent locked asset for a creator", async () => {
      const asset = { id: "ar_1", approvalState: "locked" };
      prisma.assetRecord.findMany.mockResolvedValue([asset]);

      const result = await store.findLockedByCreator("cr_1");

      expect(prisma.assetRecord.findMany).toHaveBeenCalledWith({
        where: { creatorId: "cr_1", approvalState: "locked" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(result).toEqual(asset);
    });

    it("returns null when no locked asset exists", async () => {
      prisma.assetRecord.findMany.mockResolvedValue([]);

      const result = await store.findLockedByCreator("cr_1");

      expect(result).toBeNull();
    });
  });

  describe("updateApprovalState", () => {
    it("updates approval state", async () => {
      prisma.assetRecord.update.mockResolvedValue({ id: "ar_1", approvalState: "approved" });

      const result = await store.updateApprovalState("ar_1", "approved");

      expect(prisma.assetRecord.update).toHaveBeenCalledWith({
        where: { id: "ar_1" },
        data: { approvalState: "approved" },
      });
      expect(result.approvalState).toBe("approved");
    });
  });

  describe("updateQaMetrics", () => {
    it("updates QA metrics and history", async () => {
      const metrics = {
        hardChecks: { artifactFlags: [] },
        softScores: {},
        overallDecision: "pass",
      };
      const history = [{ attempt: 1, provider: "kling", score: metrics }];
      prisma.assetRecord.update.mockResolvedValue({
        id: "ar_1",
        qaMetrics: metrics,
        qaHistory: history,
      });

      const result = await store.updateQaMetrics("ar_1", metrics, history);

      expect(prisma.assetRecord.update).toHaveBeenCalledWith({
        where: { id: "ar_1" },
        data: { qaMetrics: metrics, qaHistory: history },
      });
      expect(result.qaMetrics).toEqual(metrics);
    });
  });
});
