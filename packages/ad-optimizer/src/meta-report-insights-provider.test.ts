import { describe, it, expect } from "vitest";
import { MetaReportInsightsProvider } from "./meta-report-insights-provider.js";
import type { AdsClientInterface } from "./audit-runner.js";

function stubAdsClient(rows: unknown[]): AdsClientInterface {
  return {
    getCampaignInsights: async () => rows as never[],
    getAdSetInsights: async () => [],
    getAccountSummary: async () => ({ id: "act_123", name: "Test", currency: "USD" }) as never,
  };
}

describe("MetaReportInsightsProvider", () => {
  const dateRange = { since: "2026-04-01", until: "2026-04-30" };

  describe("getCampaignMetrics", () => {
    it("returns per-campaign rows", async () => {
      const client = stubAdsClient([
        {
          campaignId: "c1",
          campaignName: "Spring-Buyers",
          spend: 620,
          impressions: 48000,
          clicks: 580,
          cpc: 1.07,
          ctr: 1.21,
          conversions: 14,
        },
        {
          campaignId: "c2",
          campaignName: "Retargeting",
          spend: 217,
          impressions: 15000,
          clicks: 210,
          cpc: 1.03,
          ctr: 1.4,
          conversions: 9,
        },
      ]);

      const provider = new MetaReportInsightsProvider(client);
      const result = await provider.getCampaignMetrics(dateRange);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        campaignId: "c1",
        campaignName: "Spring-Buyers",
        spend: 620,
        impressions: 48000,
        clicks: 580,
        cpc: 1.07,
        ctr: 1.21,
        conversions: 14,
      });
    });

    it("returns empty array when no campaigns", async () => {
      const client = stubAdsClient([]);
      const provider = new MetaReportInsightsProvider(client);
      const result = await provider.getCampaignMetrics(dateRange);
      expect(result).toEqual([]);
    });
  });

  describe("getAggregateMetrics (existing)", () => {
    it("still aggregates correctly", async () => {
      const client = stubAdsClient([
        {
          impressions: 100,
          clicks: 10,
          spend: 50,
          actions: [{ action_type: "landing_page_view", value: "8" }],
        },
        {
          impressions: 200,
          clicks: 20,
          spend: 75,
          actions: [],
        },
      ]);

      const provider = new MetaReportInsightsProvider(client);
      const result = await provider.getAggregateMetrics(dateRange);

      expect(result).toEqual({
        impressions: 300,
        clicks: 30,
        landingPageViews: 8,
        spend: 125,
      });
    });
  });
});
