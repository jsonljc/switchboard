// Integration proof: AuditRunner wired with the real MetaCampaignInsightsProvider.
// These tests exercise the full provider→runner pipeline without any stubs,
// confirming that the real Meta Graph-backed logic fires pause on a durable
// daily CPA breach and correctly downgrades to watch when a material child
// ad set is LEARNING.
import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import { MetaCampaignInsightsProvider } from "../meta-campaign-insights-provider.js";
import type { CrmDataProvider } from "@switchboard/schemas";

function fakeCrm(): CrmDataProvider {
  return {
    getFunnelData: async () => ({
      campaignIds: [],
      leads: 0,
      qualified: 0,
      opportunities: 0,
      bookings: 0,
      closed: 0,
      revenue: 0,
      rates: {
        leadToQualified: null,
        qualifiedToBooking: null,
        bookingToClosed: null,
        leadToClosed: null,
      },
      coverage: {
        attributedContacts: 0,
        contactsWithEmailOrPhone: 0,
        contactsWithOpportunity: 0,
        contactsWithBooking: 0,
        contactsWithRevenueEvent: 0,
      },
    }),
    getBenchmarks: async () => ({
      leadToQualifiedRate: null,
      qualifiedToBookingRate: null,
      bookingToClosedRate: null,
      leadToClosedRate: null,
    }),
  };
}

describe("AuditRunner integration — real MetaCampaignInsightsProvider", () => {
  it("fires a pause recommendation on a durable daily breach (real provider, no stub)", async () => {
    const campaign = "c_dur";
    const aggInsight = {
      campaignId: campaign,
      campaignName: "Durable",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      impressions: 10000,
      inlineLinkClicks: 200,
      spend: 6000,
      // PR2: ≥ MIN_LEADS_FOR_TIER2 (30) so the account reaches tier "cpl" and
      // the pause recommendation is not withheld as a tier-3 watch.
      conversions: 30,
      revenue: 0,
      frequency: 1.3,
      cpm: 5,
      inlineLinkClickCtr: 1,
      costPerInlineLinkClick: 1,
      dateStart: "2026-05-25",
      dateStop: "2026-06-01",
    };
    const dailyRows = Array.from({ length: 14 }, (_, i) => ({
      ...aggInsight,
      spend: i < 8 ? 600 : 30,
      conversions: i < 8 ? 3 : 1,
      dateStart: `2026-05-${String(18 + i).padStart(2, "0")}`,
      dateStop: `2026-05-${String(18 + i).padStart(2, "0")}`,
    }));
    const adsClient = {
      getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
        p.timeIncrement === 1 ? dailyRows : [aggInsight],
      ),
      getAdSetInsights: vi.fn(async () => []),
      getAccountSummary: vi.fn(async () => ({
        accountId: "a",
        accountName: "n",
        currency: "USD",
        totalSpend: 6000,
        totalImpressions: 10000,
        totalClicks: 200,
        activeCampaigns: 1,
      })),
      getAdSetLearningInputs: vi.fn(async () => [
        {
          adSetId: "as",
          adSetName: "as",
          campaignId: campaign,
          learningStageStatus: "SUCCESS",
          frequency: 1,
          spend: 6000,
          conversions: 30,
          cpa: 200,
          roas: 0,
          inlineLinkClickCtr: 1,
        },
      ]),
    };
    const runner = new AuditRunner({
      adsClient: adsClient as never,
      crmDataProvider: fakeCrm(),
      insightsProvider: new MetaCampaignInsightsProvider(adsClient as never),
      config: {
        accountId: "a",
        orgId: "o",
        targetCPA: 50,
        targetROAS: 2,
        mediaBenchmarks: { inlineLinkClickCtr: 1, landingPageViewRate: 0.5 },
      },
    });
    const report = await runner.run({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
    });
    expect(report.recommendations.map((r) => r.action)).toContain("pause");
  });

  it("downgrades to watch when a material child ad set is LEARNING", async () => {
    const campaign = "c_learn";
    // conversions >= MIN_LEADS_FOR_TIER2 (30) so the account reaches tier "cpl",
    // meaning the pause passes tiering and the LEARNING guard is the actual mechanism
    // that downgrades it to a watch. aggregate CPA = 6000/30 = 200 > 3×50 = 150 so
    // the pause recommendation is generated before the learning guard gate.
    const aggInsight = {
      campaignId: campaign,
      campaignName: "Learning",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      impressions: 10000,
      inlineLinkClicks: 200,
      spend: 6000,
      conversions: 30,
      revenue: 0,
      frequency: 1.3,
      cpm: 5,
      inlineLinkClickCtr: 1,
      costPerInlineLinkClick: 1,
      dateStart: "2026-05-25",
      dateStop: "2026-06-01",
    };
    const dailyRows = Array.from({ length: 14 }, (_, i) => ({
      ...aggInsight,
      spend: i < 8 ? 600 : 30,
      conversions: i < 8 ? 1 : 3,
      dateStart: `2026-05-${String(18 + i).padStart(2, "0")}`,
      dateStop: `2026-05-${String(18 + i).padStart(2, "0")}`,
    }));
    const adsClient = {
      getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
        p.timeIncrement === 1 ? dailyRows : [aggInsight],
      ),
      getAdSetInsights: vi.fn(async () => []),
      getAccountSummary: vi.fn(async () => ({
        accountId: "a",
        accountName: "n",
        currency: "USD",
        totalSpend: 6000,
        totalImpressions: 10000,
        totalClicks: 200,
        activeCampaigns: 1,
      })),
      getAdSetLearningInputs: vi.fn(async () => [
        {
          adSetId: "as",
          adSetName: "as",
          campaignId: campaign,
          learningStageStatus: "LEARNING",
          frequency: 1,
          spend: 6000,
          conversions: 30,
          cpa: 200,
          roas: 0,
          inlineLinkClickCtr: 1,
        },
      ]),
    };
    const runner = new AuditRunner({
      adsClient: adsClient as never,
      crmDataProvider: fakeCrm(),
      insightsProvider: new MetaCampaignInsightsProvider(adsClient as never),
      config: {
        accountId: "a",
        orgId: "o",
        targetCPA: 50,
        targetROAS: 2,
        mediaBenchmarks: { inlineLinkClickCtr: 1, landingPageViewRate: 0.5 },
      },
    });
    const report = await runner.run({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
    });
    expect(report.recommendations.every((r) => r.action !== "pause")).toBe(true);
    expect(report.watches.length).toBeGreaterThan(0);
  });

  it("holds a reset-class rec (add_creative) as an in_learning_phase watch when a material child ad set is LEARNING", async () => {
    // Task 8 Step 4 live-path proof: a campaign whose aggregate CPA is between 2x and 3x
    // the target emits a reset-class `add_creative` (resetsLearning:"yes") but NOT a pause
    // (which needs >3x). A material child ad set is LEARNING, so the V2 reset-class lockout
    // — wired off the real provider's `learningStatus` (deriveLearningPhase, no extra fetch)
    // — must convert add_creative to an `in_learning_phase` watch. aggregate CPA = 3600/30 =
    // 120 = 2.4x the 50 target; conversions 30 >= tier-2 floor so it isn't a tier-3 watch.
    const campaign = "c_reset_learn";
    const aggInsight = {
      campaignId: campaign,
      campaignName: "ResetLearn",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      impressions: 10000,
      inlineLinkClicks: 200,
      spend: 3600,
      conversions: 30,
      revenue: 0,
      frequency: 1.3,
      cpm: 5,
      inlineLinkClickCtr: 1,
      costPerInlineLinkClick: 1,
      dateStart: "2026-05-25",
      dateStop: "2026-06-01",
    };
    // 8 of 14 days breach the 50 target (300/3 = 100 > 50); the rest are quiet.
    const dailyRows = Array.from({ length: 14 }, (_, i) => ({
      ...aggInsight,
      spend: i < 8 ? 300 : 30,
      conversions: i < 8 ? 3 : 1,
      dateStart: `2026-05-${String(18 + i).padStart(2, "0")}`,
      dateStop: `2026-05-${String(18 + i).padStart(2, "0")}`,
    }));
    const adsClient = {
      getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
        p.timeIncrement === 1 ? dailyRows : [aggInsight],
      ),
      getAdSetInsights: vi.fn(async () => []),
      getAccountSummary: vi.fn(async () => ({
        accountId: "a",
        accountName: "n",
        currency: "USD",
        totalSpend: 3600,
        totalImpressions: 10000,
        totalClicks: 200,
        activeCampaigns: 1,
      })),
      getAdSetLearningInputs: vi.fn(async () => [
        {
          adSetId: "as",
          adSetName: "as",
          campaignId: campaign,
          learningStageStatus: "LEARNING",
          frequency: 1,
          spend: 3600,
          conversions: 30,
          cpa: 120,
          roas: 0,
          inlineLinkClickCtr: 1,
        },
      ]),
    };
    const runner = new AuditRunner({
      adsClient: adsClient as never,
      crmDataProvider: fakeCrm(),
      insightsProvider: new MetaCampaignInsightsProvider(adsClient as never),
      config: {
        accountId: "a",
        orgId: "o",
        targetCPA: 50,
        targetROAS: 2,
        mediaBenchmarks: { inlineLinkClickCtr: 1, landingPageViewRate: 0.5 },
      },
    });
    const report = await runner.run({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
    });
    // The reset-class action is held, not recommended...
    expect(report.recommendations.every((r) => r.action !== "add_creative")).toBe(true);
    // ...as an in_learning_phase watch. NOTE: on the live seam V1 and V2 share one
    // `learningStatus`, so when state==="learning" V1 would ALSO convert this watch — but
    // V2 runs first (with `continue`), so the V2-specific message proves the Step-4 wiring
    // executed (the reset-class lockout), not the V1 campaign-level backstop. The strict
    // V1-vs-V2 isolation (SUCCESS status + learningPhaseActive:true) lives in the unit test.
    const watch = report.watches.find((w) => w.pattern === "in_learning_phase");
    expect(watch).toBeDefined();
    expect(watch?.message).toContain("add_creative");
    expect(watch?.message).toContain("reset Meta's learning phase");
  });

  it("abstains (no recs/watches, one coverage insight) when injected coverage is below the floor", async () => {
    // Gate 0: when a coverageValidator is injected and reports coverage below the
    // sufficiency floor, the audit returns an abstention report and never reaches
    // per-campaign analysis. The ads client should not be called for insights.
    const adsClient = {
      getCampaignInsights: vi.fn(async () => []),
      getAdSetInsights: vi.fn(async () => []),
      getAccountSummary: vi.fn(async () => ({
        accountId: "a",
        accountName: "n",
        currency: "USD",
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
        activeCampaigns: 0,
      })),
    };
    const coverageValidator = {
      validate: vi.fn(async () => ({
        bySource: {} as never,
        coveragePct: 0.2,
      })),
    };
    const runner = new AuditRunner({
      adsClient: adsClient as never,
      crmDataProvider: fakeCrm(),
      insightsProvider: new MetaCampaignInsightsProvider(adsClient as never),
      config: {
        accountId: "a",
        orgId: "o",
        targetCPA: 50,
        targetROAS: 2,
        mediaBenchmarks: { inlineLinkClickCtr: 1, landingPageViewRate: 0.5 },
      },
      coverageValidator,
    });
    const report = await runner.run({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
    });

    expect(coverageValidator.validate).toHaveBeenCalledWith({ orgId: "o", accountId: "a" });
    expect(report.recommendations).toEqual([]);
    expect(report.watches).toEqual([]);
    expect(report.insights).toHaveLength(1);
    expect(report.insights[0]?.campaignId).toBe("account");
    expect(report.insights[0]?.category).toBe("coverage_insufficient");
    expect(report.insights[0]?.message.toLowerCase()).toContain("coverage");
    // Abstention short-circuits before any insights pull.
    expect(adsClient.getCampaignInsights).not.toHaveBeenCalled();
  });
});
