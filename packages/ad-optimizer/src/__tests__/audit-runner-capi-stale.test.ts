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

// End-to-end proof that the account-level harden_capi_attribution advisory is wired into the
// live audit path (producer-population): it fires once on a stale account, stays silent on a
// healthy one, and abstains on an unmeasured (thin-traffic) one. No coverageValidator or
// signalHealthChecker is wired, so the audit takes the main path (no early short-circuit).

function insight(over: Partial<CampaignInsight> = {}): CampaignInsight {
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
    dateStart: "2026-03-01",
    dateStop: "2026-03-31",
    ...over,
  };
}

function funnelData(): CrmFunnelData {
  return {
    campaignIds: ["camp-1"],
    leads: 0,
    qualified: 0,
    opportunities: 0,
    bookings: 0,
    closed: 0,
    revenue: 0,
    rates: { leadToQualified: 0, qualifiedToBooking: 0, bookingToClosed: 0, leadToClosed: 0 },
    coverage: {
      attributedContacts: 0,
      contactsWithEmailOrPhone: 0,
      contactsWithOpportunity: 0,
      contactsWithBooking: 0,
      contactsWithRevenueEvent: 0,
    },
  };
}

function crmBenchmarks(): FunnelBenchmarks {
  return {
    leadToQualifiedRate: 0.4,
    qualifiedToBookingRate: 0.5,
    bookingToClosedRate: 0.25,
    leadToClosedRate: 0.06,
  };
}

function mediaBenchmarks(): MediaBenchmarks {
  return { inlineLinkClickCtr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 };
}

function accountSummary(): AccountSummary {
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

function learningInput(): CampaignLearningInput {
  return {
    effectiveStatus: "ACTIVE",
    learningPhase: false,
    lastModifiedDays: 14,
    optimizationEvents: 100,
  };
}

function targetBreach(): TargetBreachResult {
  return { periodsAboveTarget: 0, granularity: "daily", isApproximate: false };
}

function deps(current: CampaignInsight[], previous: CampaignInsight[]): AuditDependencies {
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(previous),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(accountSummary()),
  };
  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(funnelData()),
    getBenchmarks: vi.fn().mockResolvedValue(crmBenchmarks()),
  };
  const insightsProvider: CampaignInsightsProvider = {
    getCampaignLearningData: vi.fn().mockResolvedValue(learningInput()),
    getTargetBreachStatus: vi.fn().mockResolvedValue(targetBreach()),
  };
  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 100,
    targetROAS: 3.0,
    mediaBenchmarks: mediaBenchmarks(),
  };
  return { adsClient, crmDataProvider, insightsProvider, config };
}

const RANGE = {
  dateRange: { since: "2026-03-25", until: "2026-03-31" },
  previousDateRange: { since: "2026-03-18", until: "2026-03-24" },
};

function hardenCount(recs: { action: string }[]): number {
  return recs.filter((r) => r.action === "harden_capi_attribution").length;
}

describe("AuditRunner CAPI-attribution-stale advisory", () => {
  it("fires exactly one account-level harden rec on a stale account (zero conv, real traffic)", async () => {
    const stale = [insight({ conversions: 0, inlineLinkClicks: 60, revenue: 0 })];
    const report = await new AuditRunner(deps(stale, stale)).run(RANGE);
    const harden = report.recommendations.filter((r) => r.action === "harden_capi_attribution");
    expect(harden).toHaveLength(1);
    expect(harden[0]?.campaignId).toBe("account");
  });

  it("does NOT fire on a healthy account (conversions flowing)", async () => {
    const healthy = [insight({ conversions: 50, inlineLinkClicks: 2_000 })];
    const report = await new AuditRunner(deps(healthy, healthy)).run(RANGE);
    expect(hardenCount(report.recommendations)).toBe(0);
  });

  it("abstains on an unmeasured account (zero conv but traffic below the floor)", async () => {
    const thin = [insight({ conversions: 0, inlineLinkClicks: 10, revenue: 0 })];
    const report = await new AuditRunner(deps(thin, thin)).run(RANGE);
    expect(hardenCount(report.recommendations)).toBe(0);
  });
});
