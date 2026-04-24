import { describe, it, expect, vi } from "vitest";
import { MetaCampaignInsightsProvider } from "./meta-campaign-insights-provider.js";
import type { AdsClientInterface } from "./audit-runner.js";
import type { WeeklyCampaignSnapshot } from "@switchboard/schemas";

function makeAdsClient(): AdsClientInterface {
  return {
    getCampaignInsights: vi.fn().mockResolvedValue([]),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue({
      accountId: "act_1",
      accountName: "Test",
      currency: "SGD",
      totalSpend: 0,
      totalImpressions: 0,
      totalClicks: 0,
      activeCampaigns: 0,
    }),
  };
}

describe("MetaCampaignInsightsProvider", () => {
  describe("getTargetBreachStatus", () => {
    it("returns 0 periods when CPA is below target in all snapshots", async () => {
      const snapshots: WeeklyCampaignSnapshot[] = [
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 10,
          cpa: 10,
        },
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 10,
          cpa: 10,
        },
      ];

      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
        snapshots,
      });

      expect(result.periodsAboveTarget).toBe(0);
      expect(result.granularity).toBe("weekly");
      expect(result.isApproximate).toBe(true);
    });

    it("counts periods where CPA exceeds targetCPA", async () => {
      const snapshots: WeeklyCampaignSnapshot[] = [
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 2,
          cpa: 50,
        },
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 10,
          cpa: 10,
        },
      ];

      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
        snapshots,
      });

      expect(result.periodsAboveTarget).toBe(1);
    });

    it("skips periods with null CPA", async () => {
      const snapshots: WeeklyCampaignSnapshot[] = [
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 0,
          conversions: 0,
          cpa: null,
        },
      ];

      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
        snapshots,
      });

      expect(result.periodsAboveTarget).toBe(0);
    });

    it("returns 0 periods when no snapshots provided", async () => {
      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
      });

      expect(result.periodsAboveTarget).toBe(0);
      expect(result.granularity).toBe("weekly");
      expect(result.isApproximate).toBe(true);
    });
  });

  describe("getCampaignLearningData", () => {
    it("delegates to adsClient", async () => {
      const adsClient = makeAdsClient();
      (adsClient.getCampaignInsights as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          campaignId: "c1",
          campaignName: "Test",
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          impressions: 10000,
          clicks: 200,
          spend: 1000,
          conversions: 50,
          revenue: 5000,
          frequency: 2,
          cpm: 100,
          ctr: 2,
          cpc: 5,
          dateStart: "2026-04-01",
          dateStop: "2026-04-07",
        },
      ]);

      const provider = new MetaCampaignInsightsProvider(adsClient);
      const result = await provider.getCampaignLearningData({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
      });

      expect(result.effectiveStatus).toBe("ACTIVE");
      expect(result.optimizationEvents).toBe(50);
    });
  });
});
