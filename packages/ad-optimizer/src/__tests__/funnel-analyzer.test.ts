// packages/core/src/ad-optimizer/__tests__/funnel-analyzer.test.ts
import { describe, it, expect } from "vitest";
import { analyzeFunnel } from "../funnel-analyzer.js";
import type { FunnelInput } from "../funnel-analyzer.js";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

function makeInsight(impressions: number, clicks: number): CampaignInsight {
  return {
    campaignId: "c1",
    campaignName: "Test Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions,
    clicks,
    spend: 100,
    conversions: 5,
    revenue: 500,
    frequency: 1.5,
    cpm: 10,
    ctr: clicks / impressions,
    cpc: 100 / clicks,
    dateStart: "2024-01-01",
    dateStop: "2024-01-31",
  };
}

describe("analyzeFunnel", () => {
  it("computes funnel stages with correct rates from normal data", () => {
    const input: FunnelInput = {
      insights: [makeInsight(10_000, 300), makeInsight(5_000, 100)],
      crmData: { leads: 50, qualified: 20, closed: 5, revenue: 10_000 },
      benchmarks: {
        ctr: 2.5,
        landingPageViewRate: 0.8,
        leadRate: 0.04,
        qualificationRate: 0.5,
        closeRate: 0.3,
      },
    };

    const result = analyzeFunnel(input);

    expect(result.stages).toHaveLength(6);

    const [impressions, clicks, lpv, leads, qualified, closed] = result.stages as [
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
    ];

    // Impressions stage
    expect(impressions.name).toBe("Impressions");
    expect(impressions.count).toBe(15_000);
    expect(impressions.rate).toBe(1);
    expect(impressions.benchmark).toBe(1);
    expect(impressions.delta).toBe(0);

    // Clicks stage: 400/15000 = ~0.02667
    expect(clicks.name).toBe("Clicks");
    expect(clicks.count).toBe(400);
    expect(clicks.rate).toBeCloseTo(400 / 15_000, 5);
    expect(clicks.benchmark).toBeCloseTo(2.5 / 100, 5);
    expect(clicks.delta).toBeCloseTo(400 / 15_000 - 2.5 / 100, 5);

    // Landing Page Views: round(400 * 0.8) = 320, rate = 0.8
    expect(lpv.name).toBe("Landing Page Views");
    expect(lpv.count).toBe(320);
    expect(lpv.rate).toBe(0.8);
    expect(lpv.benchmark).toBe(0.8);
    expect(lpv.delta).toBeCloseTo(0, 5);

    // Leads: 50 leads, rate = 50/320 (leads/LPV)
    expect(leads.name).toBe("Leads");
    expect(leads.count).toBe(50);
    expect(leads.rate).toBeCloseTo(50 / 320, 5);
    expect(leads.benchmark).toBe(0.04);

    // Qualified: 20/50 = 0.4
    expect(qualified.name).toBe("Qualified");
    expect(qualified.count).toBe(20);
    expect(qualified.rate).toBeCloseTo(20 / 50, 5);
    expect(qualified.benchmark).toBe(0.5);

    // Closed: 5/20 = 0.25
    expect(closed.name).toBe("Closed");
    expect(closed.count).toBe(5);
    expect(closed.rate).toBeCloseTo(5 / 20, 5);
    expect(closed.benchmark).toBe(0.3);
  });

  it("identifies the worst leakage point when lead rate is far below benchmark", () => {
    // LPV count = round(1000 * 0.8) = 800
    // Lead rate: 5/800 = 0.00625, benchmark 0.04 → delta = -0.03375
    // Qualification rate: 2/5 = 0.4, benchmark 0.5 → delta = -0.1
    // Close rate: 1/2 = 0.5, benchmark 0.3 → delta = +0.2
    // CTR rate: 1000/10000 = 0.1, benchmark 0.025 → delta = +0.075
    // Worst negative delta is Qualification at -0.1
    const input: FunnelInput = {
      insights: [makeInsight(10_000, 1_000)],
      crmData: { leads: 5, qualified: 2, closed: 1, revenue: 1_000 },
      benchmarks: {
        ctr: 2.5,
        landingPageViewRate: 0.8,
        leadRate: 0.04,
        qualificationRate: 0.5,
        closeRate: 0.3,
      },
    };

    const result = analyzeFunnel(input);

    // Qualified delta = 2/5 - 0.5 = -0.1
    // Lead delta = 5/1000 - 0.04 = -0.035
    // Worst leakage is Qualified
    expect(result.leakagePoint).toBe("Qualified");
    expect(result.leakageMagnitude).toBeCloseTo(0.1, 5);
  });

  it("handles zero impressions gracefully with leakageMagnitude=0", () => {
    const input: FunnelInput = {
      insights: [],
      crmData: { leads: 0, qualified: 0, closed: 0, revenue: 0 },
      benchmarks: {
        ctr: 2.5,
        landingPageViewRate: 0.8,
        leadRate: 0.04,
        qualificationRate: 0.5,
        closeRate: 0.3,
      },
    };

    const result = analyzeFunnel(input);

    expect(result.leakageMagnitude).toBe(0);
    expect(result.stages).toHaveLength(6);

    // All counts should be 0
    for (const stage of result.stages) {
      expect(stage.count).toBe(0);
    }
  });
});
