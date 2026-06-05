// Account-level source-reallocation integration test for AuditRunner: the per-source
// economics (previously computed-then-discarded) now drive one advisory
// shift_budget_to_source rec in the report. Sibling audit-runner test files duplicate
// these fixtures by convention (there is no shared fixtures module).
import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import type { AuditDependencies, AdsClientInterface, AuditConfig } from "../audit-runner.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  AccountSummarySchema as AccountSummary,
  CrmDataProvider,
  CrmFunnelData,
  FunnelBenchmarks,
  MediaBenchmarks,
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
} from "@switchboard/schemas";

function makeCampaignInsight(overrides: Partial<CampaignInsight> = {}): CampaignInsight {
  return {
    campaignId: "camp-1",
    campaignName: "Test Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 100_000,
    inlineLinkClicks: 2_000,
    spend: 5_000,
    conversions: 50,
    revenue: 15_000,
    frequency: 2.5,
    cpm: 50,
    inlineLinkClickCtr: 2.0,
    costPerInlineLinkClick: 2.5,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
    ...overrides,
  };
}

function makeFunnelData(): CrmFunnelData {
  return {
    campaignIds: ["camp-1"],
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

// Clear per-source winner: ctwa trueROAS (revenue $20k / ~$2.9k spend ≈ 7x) dwarfs
// instant_form (~0.9x); both sides clear the per-source floor (>=10 leads, >=3 bookings).
function funnelWithSources(): CrmFunnelData {
  return {
    ...makeFunnelData(),
    bySource: {
      ctwa: { received: 40, qualified: 20, booked: 10, showed: 0, paid: 12, revenue: 2_000_000 },
      instant_form: {
        received: 30,
        qualified: 12,
        booked: 6,
        showed: 0,
        paid: 3,
        revenue: 200_000,
      },
    },
  } as CrmFunnelData;
}

function makeAccountSummary(): AccountSummary {
  return {
    accountId: "act-123",
    accountName: "Test Account",
    currency: "USD",
    totalSpend: 5_000,
    totalImpressions: 100_000,
    totalClicks: 2_000,
    activeCampaigns: 1,
  };
}

function makeCrmBenchmarks(): FunnelBenchmarks {
  return {
    leadToQualifiedRate: 0.4,
    qualifiedToBookingRate: 0.5,
    bookingToClosedRate: 0.25,
    leadToClosedRate: 0.06,
  };
}

function makeMediaBenchmarks(): MediaBenchmarks {
  return { inlineLinkClickCtr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 };
}

function makeLearningInput(): CampaignLearningInput {
  return {
    effectiveStatus: "ACTIVE",
    learningPhase: false,
    lastModifiedDays: 14,
    optimizationEvents: 100,
  };
}

function makeTargetBreach(): TargetBreachResult {
  return { periodsAboveTarget: 0, granularity: "daily", isApproximate: false };
}

function buildDeps(): AuditDependencies {
  // current === previous (stable, at target) so the only rec is the source shift, and
  // the denominator-step-change guard leaves measurement trusted.
  const insight = makeCampaignInsight();
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi.fn().mockResolvedValueOnce([insight]).mockResolvedValueOnce([insight]),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
  };
  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(funnelWithSources()),
    getBenchmarks: vi.fn().mockResolvedValue(makeCrmBenchmarks()),
  };
  const insightsProvider: CampaignInsightsProvider = {
    getCampaignLearningData: vi.fn().mockResolvedValue(makeLearningInput()),
    getTargetBreachStatus: vi.fn().mockResolvedValue(makeTargetBreach()),
  };
  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 100,
    targetROAS: 3.0,
    mediaBenchmarks: makeMediaBenchmarks(),
  };
  // Ad-set destination data fully attributes camp-1's $5,000 spend to its sources
  // (WHATSAPP -> ctwa $2,000, ON_AD -> instant_form $3,000), so per-source spend is real
  // (not the lead-share fallback) and the reallocation's spend-attribution gate passes.
  const getAdSetInsights = vi.fn().mockResolvedValue([
    {
      adSetId: "as-ctwa",
      adSetName: "CTWA ad set",
      campaignId: "camp-1",
      learningStageStatus: "SUCCESS",
      frequency: 1.2,
      spend: 2000,
      conversions: 30,
      cpa: 66,
      roas: 10,
      inlineLinkClickCtr: 2.0,
      destinationType: "WHATSAPP",
    },
    {
      adSetId: "as-if",
      adSetName: "Instant Form ad set",
      campaignId: "camp-1",
      learningStageStatus: "SUCCESS",
      frequency: 1.2,
      spend: 3000,
      conversions: 20,
      cpa: 150,
      roas: 0.67,
      inlineLinkClickCtr: 2.0,
      destinationType: "ON_AD",
    },
  ]);
  return { adsClient, crmDataProvider, insightsProvider, config, getAdSetInsights };
}

describe("AuditRunner — account-level source reallocation", () => {
  it("emits one advisory shift_budget_to_source rec when a source clearly wins", async () => {
    const runner = new AuditRunner(buildDeps());
    const report = await runner.run({
      dateRange: { since: "2026-03-01", until: "2026-03-31" },
      previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
    });

    // the per-source comparison still reaches the report (relocation preserved it)
    expect(report.sourceComparison?.rows).toHaveLength(2);
    // and now it ALSO drives a single account-level advisory rec
    const shift = report.recommendations.filter((r) => r.action === "shift_budget_to_source");
    expect(shift).toHaveLength(1);
    expect(shift[0]!.campaignId).toBe("account");
    expect(shift[0]!.params).toMatchObject({ from: "instant_form", to: "ctwa" });
  });
});
