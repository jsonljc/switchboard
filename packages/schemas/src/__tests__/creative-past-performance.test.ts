import { describe, it, expect } from "vitest";
import { CreativePastPerformanceSchema } from "../creative-job.js";

function validRow() {
  return {
    kind: "measured_performance",
    version: 1,
    asOf: "2026-06-04T06:30:00.000Z",
    window: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z", days: 34 },
    delivery: "measured",
    join: { metaCampaignId: "camp_1", metaAdId: "ad_1", metaVideoId: "vid_1" },
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

describe("CreativePastPerformanceSchema", () => {
  it("parses a valid measured row", () => {
    const parsed = CreativePastPerformanceSchema.safeParse(validRow());
    expect(parsed.success).toBe(true);
  });

  it("parses a no_delivery row with null trueRoas and null join ids", () => {
    const row = {
      ...validRow(),
      delivery: "no_delivery",
      join: { metaCampaignId: "camp_1", metaAdId: null, metaVideoId: null },
      meta: {
        spend: 0,
        impressions: 0,
        inlineLinkClicks: 0,
        inlineLinkClickCtr: 0,
        conversions: 0,
        cpm: 0,
      },
      booked: { valueCents: 0, count: 0 },
      trueRoas: null,
    };
    expect(CreativePastPerformanceSchema.safeParse(row).success).toBe(true);
  });

  it("rejects a foreign kind discriminant (the shared-column firewall)", () => {
    const row = { ...validRow(), kind: "performance_history" };
    expect(CreativePastPerformanceSchema.safeParse(row).success).toBe(false);
  });

  it("rejects non-integer booked.valueCents (cents are integral)", () => {
    const row = { ...validRow(), booked: { valueCents: 250.5, count: 1 } };
    expect(CreativePastPerformanceSchema.safeParse(row).success).toBe(false);
  });

  it("rejects a mislabeled source block", () => {
    const row = {
      ...validRow(),
      source: { insights: "somewhere_else", conversions: "conversion_records" },
    };
    expect(CreativePastPerformanceSchema.safeParse(row).success).toBe(false);
  });

  it("rejects null/undefined/empty wholesale (parse-do-not-cast at every reader)", () => {
    expect(CreativePastPerformanceSchema.safeParse(null).success).toBe(false);
    expect(CreativePastPerformanceSchema.safeParse(undefined).success).toBe(false);
    expect(CreativePastPerformanceSchema.safeParse({}).success).toBe(false);
  });
});
