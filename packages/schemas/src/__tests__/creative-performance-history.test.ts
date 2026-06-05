import { describe, it, expect } from "vitest";
import {
  CreativePastPerformanceSchema,
  CreativePerformanceHistorySchema,
} from "../creative-job.js";
import { DeploymentMemoryCategorySchema } from "../deployment-memory.js";

function validHistory() {
  return {
    kind: "performance_history",
    version: 1,
    generatedAt: "2026-06-04T12:00:00.000Z",
    topPerformers: [
      {
        jobId: "job-1",
        descriptor: "polished:question",
        trueRoas: 5,
        spend: 50,
        bookedValueCents: 25000,
        window: { from: "2026-05-05T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z" },
      },
    ],
    summary: "1 measured creative(s) on this deployment; top by trueROAS listed.",
  };
}

function validMeasured() {
  return {
    kind: "measured_performance",
    version: 1,
    asOf: "2026-06-04T06:30:00.000Z",
    window: { from: "2026-05-05T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z", days: 30 },
    delivery: "measured",
    join: { metaCampaignId: "camp-1", metaAdId: null, metaVideoId: null },
    meta: {
      spend: 50,
      impressions: 1000,
      inlineLinkClicks: 40,
      inlineLinkClickCtr: 4,
      conversions: 3,
      cpm: 50,
    },
    booked: { valueCents: 25000, count: 2 },
    trueRoas: 5,
    source: { insights: "meta_campaign_insights", conversions: "conversion_records" },
  };
}

describe("CreativePerformanceHistorySchema", () => {
  it("parses a valid history row", () => {
    expect(CreativePerformanceHistorySchema.safeParse(validHistory()).success).toBe(true);
  });

  it("caps topPerformers at 3", () => {
    const row = validHistory();
    row.topPerformers = [0, 1, 2, 3].map((i) => ({
      ...validHistory().topPerformers[0]!,
      jobId: `job-${i}`,
    }));
    expect(CreativePerformanceHistorySchema.safeParse(row).success).toBe(false);
  });

  it("accepts a null trueRoas performer (measured spend, no booked revenue)", () => {
    const row = validHistory();
    row.topPerformers[0]!.trueRoas = null as unknown as number;
    expect(CreativePerformanceHistorySchema.safeParse(row).success).toBe(true);
  });
});

describe("the two pastPerformance shapes NEVER cross-validate (shared-column firewall)", () => {
  it("a history row fails CreativePastPerformanceSchema", () => {
    expect(CreativePastPerformanceSchema.safeParse(validHistory()).success).toBe(false);
  });

  it("a measured row fails CreativePerformanceHistorySchema", () => {
    expect(CreativePerformanceHistorySchema.safeParse(validMeasured()).success).toBe(false);
  });
});

describe("DeploymentMemoryCategorySchema slice-2 categories", () => {
  it("accepts taste and revenue_proven", () => {
    expect(DeploymentMemoryCategorySchema.safeParse("taste").success).toBe(true);
    expect(DeploymentMemoryCategorySchema.safeParse("revenue_proven").success).toBe(true);
  });

  it("still rejects unknown categories", () => {
    expect(DeploymentMemoryCategorySchema.safeParse("vibes").success).toBe(false);
  });

  it("keeps the legacy five", () => {
    for (const c of ["preference", "faq", "objection", "pattern", "fact"]) {
      expect(DeploymentMemoryCategorySchema.safeParse(c).success).toBe(true);
    }
  });
});
