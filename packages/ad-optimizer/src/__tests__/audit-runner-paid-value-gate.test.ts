// A12 count-vs-value gate, integration through the full AuditRunner.run() seam.
// A cheap-cost-per-lead campaign produces a `scale` rec; with the paid-value provider wired, that
// scale flows ONLY when the campaign has finite positive verified-paid value, else it demotes to a
// `scale_unproven_paid_value` watch. Mirrors the sibling audit-runner test fixtures (duplicated by
// convention; there is no shared fixtures module).
import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import type {
  AuditDependencies,
  AdsClientInterface,
  AuditConfig,
  PaidValueByCampaignProvider,
} from "../audit-runner.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  AccountSummarySchema as AccountSummary,
  CrmDataProvider,
  CrmFunnelData,
  FunnelBenchmarks,
  MediaBenchmarks,
  CampaignInsightsProvider,
  CampaignLearningInput,
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

function makeAccountSummary(): AccountSummary {
  return {
    accountId: "act-123",
    accountName: "Test Account",
    currency: "USD",
    totalSpend: 10_000,
    totalImpressions: 200_000,
    totalClicks: 4_000,
    activeCampaigns: 1,
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

// A cheap-cost-per-lead campaign: cpa = 2000/40 = 50 < 0.8 * 100 = 80 (scale rule); revenue 0 so
// roas 0 < targetROAS (isPerformingWell false -> no early insight); identical previous (no
// diagnoses); periodsAboveTarget 0 + success learning -> the ONLY rec is scale.
function buildScaleDeps(): AuditDependencies {
  const c1 = makeCampaignInsight({
    campaignId: "camp-1",
    spend: 2_000,
    conversions: 40,
    revenue: 0,
  });
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi.fn().mockResolvedValueOnce([c1]).mockResolvedValueOnce([c1]),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
  };
  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(makeFunnelData()),
    getBenchmarks: vi.fn().mockResolvedValue(makeCrmBenchmarks()),
  };
  const insightsProvider: CampaignInsightsProvider = {
    getCampaignLearningData: vi.fn().mockResolvedValue(makeLearningInput()),
    getTargetBreachStatus: vi
      .fn()
      .mockResolvedValue({ periodsAboveTarget: 0, granularity: "daily", isApproximate: false }),
  };
  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 100,
    targetROAS: 3.0,
    mediaBenchmarks: makeMediaBenchmarks(),
  };
  return {
    adsClient,
    crmDataProvider,
    insightsProvider,
    config,
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getTrendData: vi.fn().mockResolvedValue(null),
  };
}

const RANGE = {
  dateRange: { since: "2026-05-25", until: "2026-06-01" },
  previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
};

describe("AuditRunner A12 count-vs-value gate", () => {
  it("control: a cheap-cpa campaign produces a scale rec when NO paid-value provider is wired", async () => {
    const report = await new AuditRunner(buildScaleDeps()).run(RANGE);
    expect(report.recommendations.map((r) => r.action)).toContain("scale");
    expect(report.watches.map((w) => w.pattern)).not.toContain("scale_unproven_paid_value");
  });

  it("demotes the scale to a watch when the paid-value provider reports NO paid value (fail-closed)", async () => {
    const paidValueByCampaignProvider: PaidValueByCampaignProvider = {
      queryPaidValueCentsByCampaign: vi.fn().mockResolvedValue(new Map<string, number>()),
    };
    const report = await new AuditRunner({
      ...buildScaleDeps(),
      paidValueByCampaignProvider,
    }).run(RANGE);
    expect(report.recommendations.map((r) => r.action)).not.toContain("scale");
    expect(report.watches.map((w) => w.pattern)).toContain("scale_unproven_paid_value");
    expect(paidValueByCampaignProvider.queryPaidValueCentsByCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", campaignIds: ["camp-1"] }),
    );
  });

  it("lets the scale flow when the provider reports proven paid value", async () => {
    const paidValueByCampaignProvider: PaidValueByCampaignProvider = {
      queryPaidValueCentsByCampaign: vi.fn().mockResolvedValue(new Map([["camp-1", 50_000]])),
    };
    const report = await new AuditRunner({
      ...buildScaleDeps(),
      paidValueByCampaignProvider,
    }).run(RANGE);
    expect(report.recommendations.map((r) => r.action)).toContain("scale");
    expect(report.watches.map((w) => w.pattern)).not.toContain("scale_unproven_paid_value");
  });
});
