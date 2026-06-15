import { describe, it, expect, vi } from "vitest";
import { MetaCampaignInsightsProvider } from "./meta-campaign-insights-provider.js";
import type { AdsClientInterface } from "./audit-runner.js";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

// D2-7 batching: the provider must accept account-level rows pre-fetched ONCE above the
// per-campaign loop and skip its own account re-fetch, collapsing 2N Graph calls to 2.

function dailyRow(campaignId: string, overrides: Partial<CampaignInsight> = {}): CampaignInsight {
  return {
    campaignId,
    campaignName: "C",
    status: "",
    effectiveStatus: "",
    impressions: 1000,
    inlineLinkClicks: 40,
    spend: 600,
    conversions: 1,
    revenue: 0,
    frequency: 1,
    cpm: 5,
    inlineLinkClickCtr: 1,
    costPerInlineLinkClick: 1,
    dateStart: "2026-05-25",
    dateStop: "2026-05-25",
    ...overrides,
  };
}

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

describe("MetaCampaignInsightsProvider — batching (prefetched rows)", () => {
  it("uses prefetched daily rows and does NOT re-fetch the account in getTargetBreachStatus", async () => {
    const client = makeAdsClient();
    // 14 daily rows for c_1, each spend 600 / 1 conversion = cpa 600 > target 50 → breach every day.
    const prefetched = Array.from({ length: 14 }, () => dailyRow("c_1"));
    const provider = new MetaCampaignInsightsProvider(client);

    const r = await provider.getTargetBreachStatus({
      orgId: "o",
      accountId: "a",
      campaignId: "c_1",
      targetCPA: 50,
      startDate: new Date("2026-05-25"),
      endDate: new Date("2026-06-01"),
      prefetchedDailyRows: prefetched,
    });

    expect(r.periodsAboveTarget).toBe(14);
    // The whole point of the hoist: no per-campaign account re-fetch.
    expect(client.getCampaignInsights).not.toHaveBeenCalled();
  });

  it("uses prefetched learning rows and does NOT re-fetch the account in getCampaignLearningData", async () => {
    const client = makeAdsClient();
    const provider = new MetaCampaignInsightsProvider(client);

    const r = await provider.getCampaignLearningData({
      orgId: "o",
      accountId: "a",
      campaignId: "c_1",
      prefetchedLearningRows: [
        dailyRow("c_1", { conversions: 5 }),
        dailyRow("c_other", { conversions: 99 }),
      ],
    });

    // optimizationEvents sourced from the matched c_1 row, not a re-fetch.
    expect(r.optimizationEvents).toBe(5);
    // The per-campaign ad-set learning call (getAdSetLearningInputs) is a SEPARATE endpoint and
    // out of scope; here we only assert the account-level insights re-fetch is skipped.
    expect(client.getCampaignInsights).not.toHaveBeenCalled();
  });

  it("prefetchAccountRows pulls the account ONCE for daily and once for learning", async () => {
    const calls: Array<{ timeIncrement?: number }> = [];
    const client = makeAdsClient();
    (client.getCampaignInsights as ReturnType<typeof vi.fn>).mockImplementation(
      async (p: { timeIncrement?: number }) => {
        calls.push(p);
        // breach pull (timeIncrement 1) vs learning pull (no increment) return distinct shapes
        return p.timeIncrement === 1 ? [dailyRow("c_1")] : [dailyRow("c_1", { conversions: 3 })];
      },
    );
    const provider = new MetaCampaignInsightsProvider(client);

    const out = await provider.prefetchAccountRows({ endDate: new Date("2026-06-01") });

    // exactly two account-level Graph calls total, regardless of campaign count
    expect(client.getCampaignInsights).toHaveBeenCalledTimes(2);
    expect(calls.filter((c) => c.timeIncrement === 1)).toHaveLength(1); // one daily breach pull
    expect(out.daily).toHaveLength(1);
    expect(out.learning).toHaveLength(1);
  });
});
