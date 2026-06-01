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

    it("returns 0 periods when no snapshots provided and no daily rows", async () => {
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
      // With no daily rows and no snapshots, we return daily with 0 breaches
      expect(result.granularity).toBe("daily");
      expect(result.isApproximate).toBe(false);
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

// ── Task 3: real daily target-breach ─────────────────────────────────────────

function dailyRow(campaignId: string, date: string, spend: number, conversions: number) {
  return {
    campaignId,
    campaignName: "C",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 1000,
    inlineLinkClicks: 50,
    spend,
    conversions,
    revenue: 0,
    frequency: 1.2,
    cpm: 5,
    inlineLinkClickCtr: 1,
    costPerInlineLinkClick: 1,
    dateStart: date,
    dateStop: date,
  };
}

it("counts daily periods above target from time_increment=1 rows", async () => {
  // 9 of 14 days have cpa = spend/conversions > targetCPA(=50): 600/1 = 600 > 50; 40/4 = 10 <= 50
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = `2026-05-${String(18 + i).padStart(2, "0")}`;
    return i < 9 ? dailyRow("c_1", date, 600, 1) : dailyRow("c_1", date, 40, 4);
  });
  const adsClient = {
    getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
      p.timeIncrement === 1 ? days : [],
    ),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const provider = new MetaCampaignInsightsProvider(adsClient as never);
  const result = await provider.getTargetBreachStatus({
    orgId: "o",
    accountId: "act_1",
    campaignId: "c_1",
    targetCPA: 50,
    startDate: new Date("2026-05-25"),
    endDate: new Date("2026-06-01"),
  });
  expect(result.granularity).toBe("daily");
  expect(result.periodsAboveTarget).toBe(9);
  expect(adsClient.getCampaignInsights).toHaveBeenCalledWith(
    expect.objectContaining({ timeIncrement: 1 }),
  );
});

it("treats a day with spend but zero conversions as above target", async () => {
  const days = [dailyRow("c_1", "2026-05-31", 100, 0), dailyRow("c_1", "2026-06-01", 0, 0)];
  const adsClient = {
    getCampaignInsights: vi.fn(async () => days),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const provider = new MetaCampaignInsightsProvider(adsClient as never);
  const r = await provider.getTargetBreachStatus({
    orgId: "o",
    accountId: "a",
    campaignId: "c_1",
    targetCPA: 50,
    startDate: new Date("2026-05-25"),
    endDate: new Date("2026-06-01"),
  });
  expect(r.periodsAboveTarget).toBe(1); // spend>0,conv=0 counts; zero-spend day ignored
});

it("falls back to weekly snapshot count when no daily rows are returned", async () => {
  const adsClient = {
    getCampaignInsights: vi.fn(async () => []), // Meta returned nothing for the daily pull
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const provider = new MetaCampaignInsightsProvider(adsClient as never);
  const snap = (cpa: number) => ({
    campaignId: "c_1",
    startDate: new Date("2026-05-18"),
    endDate: new Date("2026-05-25"),
    spend: cpa,
    conversions: 1,
    cpa,
  });
  const r = await provider.getTargetBreachStatus({
    orgId: "o",
    accountId: "a",
    campaignId: "c_1",
    targetCPA: 50,
    startDate: new Date("2026-05-25"),
    endDate: new Date("2026-06-01"),
    snapshots: [snap(600), snap(10)], // one above target, one below
  });
  expect(r.granularity).toBe("weekly");
  expect(r.periodsAboveTarget).toBe(1);
});
