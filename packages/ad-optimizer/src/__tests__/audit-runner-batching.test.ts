import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import { MetaCampaignInsightsProvider } from "../meta-campaign-insights-provider.js";
import type { AuditDependencies, AdsClientInterface } from "../audit-runner.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  CampaignInsightsProvider,
  CrmDataProvider,
  CrmFunnelData,
  FunnelBenchmarks,
  TargetBreachResult,
  CampaignLearningInput,
} from "@switchboard/schemas";

// D2-7: the audit-runner must hoist the two account-level insight fetches ABOVE the
// per-campaign loop (via the provider's prefetchAccountRows capability) and feed the rows
// back into each per-campaign call, collapsing 2N account re-fetches to 2.

function insight(campaignId: string, o: Partial<CampaignInsight> = {}): CampaignInsight {
  return {
    campaignId,
    campaignName: campaignId,
    status: "",
    effectiveStatus: "",
    impressions: 100_000,
    inlineLinkClicks: 2_000,
    spend: 5_000,
    conversions: 50,
    revenue: 15_000,
    frequency: 2.5,
    cpm: 50,
    inlineLinkClickCtr: 2.0,
    costPerInlineLinkClick: 2.5,
    dateStart: "2026-03-01",
    dateStop: "2026-03-31",
    ...o,
  };
}

function makeFunnelData(): CrmFunnelData {
  return {
    campaignIds: ["c1"],
    leads: 100,
    qualified: 40,
    opportunities: 50,
    bookings: 25,
    closed: 10,
    revenue: 30_000,
    rates: {
      leadToQualified: 0.4,
      qualifiedToBooking: 0.625,
      bookingToClosed: 0.4,
      leadToClosed: 0.1,
    },
    coverage: {
      attributedContacts: 100,
      contactsWithEmailOrPhone: 90,
      contactsWithOpportunity: 50,
      contactsWithBooking: 25,
      contactsWithRevenueEvent: 10,
    },
  };
}

function makeBenchmarks(): FunnelBenchmarks {
  return {
    leadToQualifiedRate: 0.4,
    qualifiedToBookingRate: 0.5,
    bookingToClosedRate: 0.25,
    leadToClosedRate: 0.06,
  };
}

function makeTargetBreach(): TargetBreachResult {
  return { periodsAboveTarget: 0, granularity: "daily", isApproximate: false };
}

function makeLearningInput(): CampaignLearningInput {
  return {
    effectiveStatus: "ACTIVE",
    learningPhase: false,
    lastModifiedDays: 14,
    optimizationEvents: 100,
  };
}

function makeAdsClient(
  getCampaignInsights: AdsClientInterface["getCampaignInsights"],
): AdsClientInterface {
  return {
    getCampaignInsights,
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue({
      accountId: "act_1",
      accountName: "Test",
      currency: "USD",
      totalSpend: 0,
      totalImpressions: 0,
      totalClicks: 0,
      activeCampaigns: 0,
    }),
  };
}

function buildDeps(
  adsClient: AdsClientInterface,
  insightsProvider: CampaignInsightsProvider,
): AuditDependencies {
  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(makeFunnelData()),
    getBenchmarks: vi.fn().mockResolvedValue(makeBenchmarks()),
  };
  return {
    adsClient,
    crmDataProvider,
    insightsProvider,
    config: {
      accountId: "act_1",
      orgId: "org_1",
      targetCPA: 100,
      targetROAS: 3.0,
      mediaBenchmarks: {
        inlineLinkClickCtr: 2.0,
        landingPageViewRate: 0.85,
        clickToLeadRate: 0.05,
      },
    },
  };
}

const RANGES = {
  dateRange: { since: "2026-03-01", until: "2026-03-31" },
  previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
};

describe("AuditRunner — D2-7 account-fetch batching", () => {
  it("calls prefetchAccountRows ONCE and feeds prefetched rows into every per-campaign call", async () => {
    const three = [insight("c1"), insight("c2"), insight("c3")];
    const getCampaignInsights = vi
      .fn()
      .mockResolvedValueOnce(three) // current window pull
      .mockResolvedValueOnce(three); // previous window pull
    const adsClient = makeAdsClient(getCampaignInsights);

    const prefetchAccountRows = vi.fn().mockResolvedValue({ daily: [], learning: [] });
    const getTargetBreachStatus = vi.fn().mockResolvedValue(makeTargetBreach());
    const getCampaignLearningData = vi.fn().mockResolvedValue(makeLearningInput());
    const insightsProvider: CampaignInsightsProvider = {
      getCampaignLearningData,
      getTargetBreachStatus,
      prefetchAccountRows,
    };

    await new AuditRunner(buildDeps(adsClient, insightsProvider)).run(RANGES);

    // ONE account-level prefetch for the whole account, not one per campaign.
    expect(prefetchAccountRows).toHaveBeenCalledTimes(1);
    expect(getTargetBreachStatus).toHaveBeenCalledTimes(3);
    // Each per-campaign breach/learning call received the hoisted rows, so the provider skips
    // its own re-fetch (proven byte-for-byte in the provider batching tests).
    for (const call of getTargetBreachStatus.mock.calls) {
      expect(call[0]).toHaveProperty("prefetchedDailyRows");
    }
    for (const call of getCampaignLearningData.mock.calls) {
      expect(call[0]).toHaveProperty("prefetchedLearningRows");
    }
  });

  it("makes a bounded number of account-level Graph calls regardless of campaign count (real provider)", async () => {
    const seen: Array<{ timeIncrement?: number }> = [];
    const three = [insight("c1"), insight("c2"), insight("c3")];
    const getCampaignInsights = vi.fn(async (p: { fields: string[]; timeIncrement?: number }) => {
      seen.push(p.timeIncrement !== undefined ? { timeIncrement: p.timeIncrement } : {});
      return three;
    });
    const adsClient = makeAdsClient(getCampaignInsights);
    // The REAL provider: it would re-fetch the account per campaign without the hoist.
    const provider = new MetaCampaignInsightsProvider(adsClient);

    await new AuditRunner(buildDeps(adsClient, provider)).run(RANGES);

    // ONE daily breach pull for the whole account (was one per campaign = 3).
    expect(seen.filter((c) => c.timeIncrement === 1)).toHaveLength(1);
    // Total account-level getCampaignInsights calls are bounded + independent of N:
    // 2 window pulls (current + previous) + 2 batched prefetch pulls (daily breach + learning) = 4.
    expect(getCampaignInsights).toHaveBeenCalledTimes(4);
  });
});
