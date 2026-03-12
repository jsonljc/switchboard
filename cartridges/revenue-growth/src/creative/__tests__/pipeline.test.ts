import { describe, it, expect, vi } from "vitest";
import { CreativePipeline } from "../pipeline.js";
import { MockImageGenerator } from "../image-generator.js";
import { InMemoryTestCampaignStore } from "../../stores/in-memory.js";
import { InMemoryDispatcher } from "../../execution/dispatcher.js";
import type { NormalizedData, AccountLearningProfile } from "@switchboard/schemas";

function makeNormalizedData(overrides: Partial<NormalizedData> = {}): NormalizedData {
  return {
    accountId: "acct-1",
    organizationId: "org-1",
    collectedAt: new Date().toISOString(),
    dataTier: "FULL",
    adMetrics: {
      impressions: 100000,
      clicks: 2500,
      spend: 5000,
      conversions: 100,
      revenue: 25000,
      ctr: 0.025,
      cpc: 2,
      cpa: 50,
      roas: 5,
      frequency: 2.5,
    },
    funnelEvents: [],
    creativeAssets: {
      totalAssets: 20,
      activeAssets: 15,
      averageScore: 65,
      fatigueRate: 0.15,
      topPerformerCount: 5,
      bottomPerformerCount: 3,
      diversityScore: 55,
    },
    crmSummary: null,
    signalHealth: null,
    headroom: null,
    ...overrides,
  };
}

describe("CreativePipeline", () => {
  const pipeline = new CreativePipeline();

  it("short-circuits when no significant gaps", async () => {
    const data = makeNormalizedData({
      adMetrics: {
        impressions: 100000,
        clicks: 5000,
        spend: 5000,
        conversions: 200,
        revenue: 50000,
        ctr: 0.05,
        cpc: 1,
        cpa: 25,
        roas: 10,
        frequency: 1.5,
      },
      creativeAssets: {
        totalAssets: 20,
        activeAssets: 20,
        averageScore: 90,
        fatigueRate: 0.05,
        topPerformerCount: 12,
        bottomPerformerCount: 1,
        diversityScore: 85,
      },
    });

    const result = await pipeline.run("acct-1", "org-1", "CREATIVE", data, {});

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("No significant creative gaps");
    expect(result.generatedImages).toEqual([]);
    expect(result.campaignDeployed).toBe(false);
  });

  it("runs full pipeline when gaps are found", async () => {
    const data = makeNormalizedData({
      creativeAssets: {
        totalAssets: 5,
        activeAssets: 2,
        averageScore: 20,
        fatigueRate: 0.6,
        topPerformerCount: 0,
        bottomPerformerCount: 4,
        diversityScore: 10,
      },
    });

    const imageGenerator = new MockImageGenerator();
    const testCampaignStore = new InMemoryTestCampaignStore();
    const dispatcher = new InMemoryDispatcher();

    const result = await pipeline.run("acct-1", "org-1", "CREATIVE", data, {
      imageGenerator,
      testCampaignStore,
      dispatcher,
    });

    expect(result.skipped).toBe(false);
    expect(result.significantGaps.length).toBeGreaterThan(0);
    expect(result.strategy).toBeDefined();
    expect(result.generatedImages.length).toBeGreaterThan(0);
  });

  it("generates images for top recommendations", async () => {
    const data = makeNormalizedData({
      creativeAssets: {
        totalAssets: 5,
        activeAssets: 2,
        averageScore: 20,
        fatigueRate: 0.6,
        topPerformerCount: 0,
        bottomPerformerCount: 4,
        diversityScore: 10,
      },
    });

    const imageGenerator = new MockImageGenerator();

    const result = await pipeline.run("acct-1", "org-1", "CREATIVE", data, {
      imageGenerator,
    });

    // Should generate up to 3 images
    expect(result.generatedImages.length).toBeLessThanOrEqual(3);
    expect(result.generatedImages.length).toBeGreaterThan(0);
  });

  it("reviews generated assets", async () => {
    const data = makeNormalizedData({
      creativeAssets: {
        totalAssets: 5,
        activeAssets: 2,
        averageScore: 20,
        fatigueRate: 0.6,
        topPerformerCount: 0,
        bottomPerformerCount: 4,
        diversityScore: 10,
      },
    });

    const imageGenerator = new MockImageGenerator();

    const result = await pipeline.run("acct-1", "org-1", "CREATIVE", data, {
      imageGenerator,
    });

    // Review results should match number of generated images
    expect(result.reviewResults.length).toBe(result.generatedImages.length);
  });

  it("creates a test campaign when store is available", async () => {
    const data = makeNormalizedData({
      creativeAssets: {
        totalAssets: 5,
        activeAssets: 2,
        averageScore: 20,
        fatigueRate: 0.6,
        topPerformerCount: 0,
        bottomPerformerCount: 4,
        diversityScore: 10,
      },
    });

    const imageGenerator = new MockImageGenerator();
    const testCampaignStore = new InMemoryTestCampaignStore();

    const result = await pipeline.run("acct-1", "org-1", "CREATIVE", data, {
      imageGenerator,
      testCampaignStore,
    });

    expect(result.campaignId).toBeDefined();
    const campaign = await testCampaignStore.getById(result.campaignId!);
    expect(campaign).not.toBeNull();
  });

  it("works without image generator", async () => {
    const data = makeNormalizedData({
      creativeAssets: {
        totalAssets: 5,
        activeAssets: 2,
        averageScore: 20,
        fatigueRate: 0.6,
        topPerformerCount: 0,
        bottomPerformerCount: 4,
        diversityScore: 10,
      },
    });

    const result = await pipeline.run("acct-1", "org-1", "CREATIVE", data, {});

    expect(result.skipped).toBe(false);
    expect(result.strategy).toBeDefined();
    expect(result.generatedImages).toEqual([]);
    expect(result.campaignDeployed).toBe(false);
  });

  it("reports overall gap score", async () => {
    const data = makeNormalizedData();
    const result = await pipeline.run("acct-1", "org-1", "CREATIVE", data, {});

    expect(result.gapScore).toBeGreaterThanOrEqual(0);
    expect(result.gapScore).toBeLessThanOrEqual(100);
  });

  it("handles image generation failure gracefully", async () => {
    const data = makeNormalizedData({
      creativeAssets: {
        totalAssets: 5,
        activeAssets: 2,
        averageScore: 20,
        fatigueRate: 0.6,
        topPerformerCount: 0,
        bottomPerformerCount: 4,
        diversityScore: 10,
      },
    });

    const failingGenerator: MockImageGenerator = new MockImageGenerator();
    vi.spyOn(failingGenerator, "generate").mockRejectedValue(new Error("API error"));

    const result = await pipeline.run("acct-1", "org-1", "CREATIVE", data, {
      imageGenerator: failingGenerator,
    });

    // Should not fail, just have no images
    expect(result.skipped).toBe(false);
    expect(result.generatedImages).toEqual([]);
  });

  it("uses account profile for gap analysis when available", async () => {
    const data = makeNormalizedData({
      creativeAssets: {
        totalAssets: 5,
        activeAssets: 2,
        averageScore: 20,
        fatigueRate: 0.6,
        topPerformerCount: 0,
        bottomPerformerCount: 4,
        diversityScore: 10,
      },
    });

    const profile: AccountLearningProfile = {
      accountId: "acct-1",
      organizationId: "org-1",
      creativePatterns: [
        { format: "video", hookType: "question", performanceScore: 80, sampleSize: 5 },
      ],
      constraintHistory: [],
      calibration: {},
      updatedAt: new Date().toISOString(),
    };

    const result = await pipeline.run("acct-1", "org-1", "CREATIVE", data, {}, profile);

    expect(result.skipped).toBe(false);
    expect(result.strategy).toBeDefined();
  });
});
