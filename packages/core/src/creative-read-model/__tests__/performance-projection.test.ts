import { describe, it, expect } from "vitest";
import { derivePerformance } from "../performance-projection.js";
import { buildMiraCreativeReadModel } from "../build-read-model.js";
import type { CreativeJob } from "@switchboard/schemas";

function job(pastPerformance: unknown): CreativeJob {
  return {
    id: "job-1",
    taskId: "t-1",
    organizationId: "org-1",
    deploymentId: "dep-1",
    productDescription: "Promo",
    targetAudience: "Aud",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: pastPerformance as Record<string, unknown> | null,
    generateReferenceImages: false,
    currentStage: "complete",
    stageOutputs: {},
    stoppedAt: null,
    mode: "polished",
    createdAt: new Date("2026-05-04T00:00:00.000Z"),
    updatedAt: new Date("2026-05-04T00:00:00.000Z"),
  } as CreativeJob;
}

const MEASURED = {
  kind: "measured_performance",
  version: 1,
  asOf: "2026-06-04T06:30:00.000Z",
  window: { from: "2026-05-05T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z", days: 30 },
  delivery: "measured",
  join: { metaCampaignId: "camp-1", metaAdId: "ad-1", metaVideoId: "vid-1" },
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

describe("derivePerformance", () => {
  it("projects a valid measured row (source-labeled fields)", () => {
    expect(derivePerformance(job(MEASURED))).toEqual({
      asOf: "2026-06-04T06:30:00.000Z",
      delivery: "measured",
      spend: 50,
      trueRoas: 5,
      bookedValueCents: 25000,
      bookedCount: 2,
      metaConversions: 3,
    });
  });

  it("projects a no_delivery row (zeroed, trueRoas null)", () => {
    const noDelivery = {
      ...MEASURED,
      delivery: "no_delivery",
      meta: { ...MEASURED.meta, spend: 0, impressions: 0, conversions: 0 },
      booked: { valueCents: 0, count: 0 },
      trueRoas: null,
    };
    expect(derivePerformance(job(noDelivery))).toMatchObject({
      delivery: "no_delivery",
      spend: 0,
      trueRoas: null,
    });
  });

  it("projects nothing for null, legacy junk, and a PR-B performance_history row", () => {
    expect(derivePerformance(job(null))).toBeUndefined();
    expect(derivePerformance(job({ someLegacy: "passthrough" }))).toBeUndefined();
    expect(
      derivePerformance(
        job({
          kind: "performance_history",
          version: 1,
          generatedAt: "2026-06-04T00:00:00.000Z",
          topPerformers: [],
          summary: "s",
        }),
      ),
    ).toBeUndefined();
  });
});

describe("buildMiraCreativeReadModel performance wiring", () => {
  const opts = {
    now: new Date("2026-06-04T12:00:00.000Z"),
    weekStart: new Date("2026-06-01T00:00:00.000Z"),
    prevWeekStart: new Date("2026-05-25T00:00:00.000Z"),
    visibleLimit: 5,
  };

  it("includes performance on summaries whose row parses, omits it otherwise", () => {
    const rm = buildMiraCreativeReadModel([job(MEASURED), job(null)], opts);
    expect(rm.jobs[0]!.performance).toMatchObject({ delivery: "measured", spend: 50 });
    expect(rm.jobs[1]!.performance).toBeUndefined();
  });
});
