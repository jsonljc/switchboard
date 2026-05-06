import { describe, it, expect } from "vitest";
import { computeCampaignRollup } from "./campaign-rollup.js";
import type { RollupContext } from "./types.js";
import type { ReportInsightsProvider, ReportCampaignInsight } from "@switchboard/schemas";

const ctx: RollupContext = {
  orgId: "org-1",
  current: {
    start: new Date("2026-04-01"),
    end: new Date("2026-05-01"),
    window: "THIS MONTH",
  },
  prior: {
    start: new Date("2026-03-01"),
    end: new Date("2026-04-01"),
    window: null,
  },
  computedAt: new Date("2026-04-30"),
};

function stubProvider(campaigns: ReportCampaignInsight[]): ReportInsightsProvider {
  return {
    getAggregateMetrics: async () => ({ impressions: 0, clicks: 0, landingPageViews: 0, spend: 0 }),
    getCampaignMetrics: async () => campaigns,
  };
}

function stubRevenue(data: Array<{ sourceCampaignId: string; totalAmount: number }>) {
  return {
    revenueByCampaign: async () => data,
    sumByOrg: async () => ({ totalAmount: 0, count: 0 }),
    revenueWithFirstTouch: async () => [],
  };
}

describe("computeCampaignRollup", () => {
  it("joins Meta spend with Switchboard revenue and computes derived metrics", async () => {
    const provider = stubProvider([
      {
        campaignId: "c1",
        campaignName: "Spring",
        spend: 600,
        impressions: 40000,
        clicks: 500,
        cpc: 1.2,
        ctr: 1.25,
        conversions: 12,
      },
      {
        campaignId: "c2",
        campaignName: "Retarget",
        spend: 200,
        impressions: 15000,
        clicks: 180,
        cpc: 1.11,
        ctr: 1.2,
        conversions: 8,
      },
    ]);
    const revenue = stubRevenue([{ sourceCampaignId: "c1", totalAmount: 3000 }]);

    const result = await computeCampaignRollup(ctx, provider, revenue);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "Spring",
      spend: 600,
      impressions: 40000,
      clicks: 500,
      cpc: 1.2,
      ctr: 1.25,
      leads: 12,
      revenue: 3000,
      roas: 5,
    });
    expect(result[0]!.cpl).toBeCloseTo(50);
    expect(result[0]!.clickToLeadRate).toBeCloseTo(0.024);
    expect(result[1]).toMatchObject({
      name: "Retarget",
      spend: 200,
      leads: 8,
      revenue: 0,
      roas: 0,
    });
    expect(result[1]!.cpl).toBeCloseTo(25);
  });

  it("returns empty array when provider is null", async () => {
    const revenue = stubRevenue([]);
    const result = await computeCampaignRollup(ctx, null, revenue);
    expect(result).toEqual([]);
  });

  it("sets cpl=null when leads=0", async () => {
    const provider = stubProvider([
      {
        campaignId: "c1",
        campaignName: "No-Leads",
        spend: 100,
        impressions: 5000,
        clicks: 80,
        cpc: 1.25,
        ctr: 1.6,
        conversions: 0,
      },
    ]);
    const revenue = stubRevenue([]);
    const result2 = await computeCampaignRollup(ctx, provider, revenue);
    expect(result2[0]!.cpl).toBeNull();
    expect(result2[0]!.clickToLeadRate).toBeCloseTo(0);
  });

  it("sets clickToLeadRate=null when clicks=0", async () => {
    const provider = stubProvider([
      {
        campaignId: "c1",
        campaignName: "Zero-Clicks",
        spend: 0,
        impressions: 0,
        clicks: 0,
        cpc: 0,
        ctr: 0,
        conversions: 0,
      },
    ]);
    const revenue = stubRevenue([]);
    const result = await computeCampaignRollup(ctx, provider, revenue);
    expect(result[0]!.clickToLeadRate).toBeNull();
  });

  it("sorts by spend descending", async () => {
    const provider = stubProvider([
      {
        campaignId: "c1",
        campaignName: "Low",
        spend: 100,
        impressions: 5000,
        clicks: 80,
        cpc: 1.25,
        ctr: 1.6,
        conversions: 2,
      },
      {
        campaignId: "c2",
        campaignName: "High",
        spend: 900,
        impressions: 60000,
        clicks: 800,
        cpc: 1.13,
        ctr: 1.33,
        conversions: 20,
      },
    ]);
    const revenue = stubRevenue([]);
    const result = await computeCampaignRollup(ctx, provider, revenue);
    expect(result[0]!.name).toBe("High");
    expect(result[1]!.name).toBe("Low");
  });
});
