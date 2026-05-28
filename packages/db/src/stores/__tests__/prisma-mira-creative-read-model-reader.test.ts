import { describe, expect, it, vi } from "vitest";
import { PrismaMiraCreativeReadModelReader } from "../prisma-mira-creative-read-model-reader.js";

const base = {
  taskId: "t",
  deploymentId: "d",
  productDescription: "P",
  targetAudience: "a",
  platforms: ["meta"],
  brandVoice: null,
  productImages: [],
  references: [],
  pastPerformance: null,
  generateReferenceImages: false,
  productionTier: null,
  stageOutputs: {},
  stoppedAt: null,
  mode: "polished",
  ugcPhase: null,
  ugcPhaseOutputs: null,
  ugcPhaseOutputsVersion: null,
  ugcConfig: null,
  ugcFailure: null,
  createdAt: new Date("2026-05-26"),
  updatedAt: new Date("2026-05-26"),
};

describe("PrismaMiraCreativeReadModelReader", () => {
  it("queries org-scoped and builds the read model", async () => {
    const prisma = {
      creativeJob: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...base,
            id: "a",
            organizationId: "org1",
            currentStage: "hooks",
            stageOutputs: { trends: {} },
          },
        ]),
      },
    } as any;
    const reader = new PrismaMiraCreativeReadModelReader(prisma);
    const rm = await reader.read("org1", {
      now: new Date("2026-05-28T12:00:00Z"),
      timezone: "UTC",
    });
    expect(prisma.creativeJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org1" },
        take: 200,
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(rm.counts.awaitingReview).toBe(1);
    expect(rm.jobs[0]!.status).toBe("awaiting_review");
  });

  it("empty org → empty model", async () => {
    const prisma = { creativeJob: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    const reader = new PrismaMiraCreativeReadModelReader(prisma);
    const rm = await reader.read("orgEmpty", { now: new Date(), timezone: "UTC" });
    expect(rm.jobs).toEqual([]);
    expect(rm.counts.inFlight).toBe(0);
  });
});
