import { describe, it, expect } from "vitest";
import type { CampaignInsightSchema, CreativeJob } from "@switchboard/schemas";
import { computePastPerformance } from "./creative-attribution.js";
import {
  passesRevenueProvenFloors,
  revenueProvenCanonicalKey,
  revenueProvenBucketContent,
} from "./revenue-proven-promotion.js";

const WINDOW = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };
const NOW = new Date("2026-06-01T00:00:00Z");

// A complete CampaignInsight (15 required fields); the noise fields are fixed.
function fullInsight(spend: number): CampaignInsightSchema {
  return {
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 1000,
    inlineLinkClicks: 50,
    spend,
    conversions: 5,
    revenue: 0,
    frequency: 1.2,
    cpm: 10,
    inlineLinkClickCtr: 0.05,
    costPerInlineLinkClick: 2,
    dateStart: "2026-05-01",
    dateStop: "2026-06-01",
  };
}

// Build measured pastPerformance from the REAL producer (computePastPerformance),
// honoring "test from the real producer's output" (feedback_safety_gate_needs_producer_population).
export function measured(opts: { spend: number; valueCents: number; count: number }) {
  const job = { metaCampaignId: "c1", metaAdId: "a1", metaVideoId: "v1" } as unknown as CreativeJob;
  return computePastPerformance({
    job,
    insight: fullInsight(opts.spend),
    booked: { valueCents: opts.valueCents, count: opts.count },
    window: WINDOW,
    now: NOW,
  })!;
}

describe("passesRevenueProvenFloors", () => {
  it("passes when measured, spend>=50, bookedCount>=2, trueRoas>=1.5", () => {
    // $100 spend, $300 booked => trueRoas 3.0
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 30000, count: 3 }))).toBe(
      true,
    );
  });
  it("fails below the spend floor", () => {
    expect(passesRevenueProvenFloors(measured({ spend: 40, valueCents: 30000, count: 3 }))).toBe(
      false,
    );
  });
  it("fails below the booked-count floor", () => {
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 30000, count: 1 }))).toBe(
      false,
    );
  });
  it("fails below the trueRoas floor", () => {
    // $100 spend, $120 booked => 1.2 < 1.5
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 12000, count: 3 }))).toBe(
      false,
    );
  });
  it("fails when trueRoas is null (count 0 => null, never 0)", () => {
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 0, count: 0 }))).toBe(
      false,
    );
  });
  it("fails a no_delivery row", () => {
    const noDelivery = computePastPerformance({
      job: { metaCampaignId: "c1", metaAdId: null, metaVideoId: null } as unknown as CreativeJob,
      insight: undefined,
      booked: { valueCents: 30000, count: 3 },
      window: WINDOW,
      now: NOW,
    })!;
    expect(passesRevenueProvenFloors(noDelivery)).toBe(false);
  });
  it("guards NaN numerics (Number.isFinite)", () => {
    const perf = measured({ spend: 100, valueCents: 30000, count: 3 });
    expect(passesRevenueProvenFloors({ ...perf, trueRoas: Number.NaN })).toBe(false);
    expect(passesRevenueProvenFloors({ ...perf, meta: { ...perf.meta, spend: Number.NaN } })).toBe(
      false,
    );
  });
});

describe("revenueProvenCanonicalKey + content", () => {
  it("builds a polished hook key matching the Mira consumer regex", () => {
    const key = revenueProvenCanonicalKey({ mode: "polished", hookType: "question" });
    expect(key).toBe("revenue_proven:polished_question");
    expect(/^revenue_proven:(polished|ugc)_([a-z0-9_]+)$/.test(key)).toBe(true);
  });
  it("uses structureId for ugc", () => {
    expect(
      revenueProvenCanonicalKey({ mode: "ugc", hookType: "none", structureId: "confession" }),
    ).toBe("revenue_proven:ugc_confession");
  });
  it("content is a pure function of the bucket (no per-job text)", () => {
    const a = revenueProvenBucketContent("polished", "question", undefined);
    const b = revenueProvenBucketContent("polished", "question", undefined);
    expect(a).toBe(b);
    expect(a).not.toMatch(/c1|v1|\$/); // no campaign/video id, no per-job dollar amount
  });
});
