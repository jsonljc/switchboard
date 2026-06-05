// PR2 economic tiering integration tests for AuditRunner.
// Verifies that the booking-calibrated target and tier selection are wired correctly:
//   Tier 1 (booked_cac) → full-strength; Tier 2 (cpl) → confidence penalty;
//   Tier 3 (cpc) → destructive recs withheld as watches.
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

// ── Minimal fixtures ──

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
    dateStart: "2026-03-01",
    dateStop: "2026-03-31",
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

function makeMediaBenchmarks(): MediaBenchmarks {
  return { inlineLinkClickCtr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 };
}

function buildMockDeps(
  overrides: {
    currentInsights?: CampaignInsight[];
    previousInsights?: CampaignInsight[];
  } = {},
): AuditDependencies {
  const currentInsights = overrides.currentInsights ?? [makeCampaignInsight()];
  const previousInsights = overrides.previousInsights ?? [makeCampaignInsight()];

  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi
      .fn()
      .mockResolvedValueOnce(currentInsights)
      .mockResolvedValueOnce(previousInsights),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue({
      accountId: "act-123",
      accountName: "Test Account",
      currency: "USD",
      totalSpend: 10_000,
      totalImpressions: 200_000,
      totalClicks: 4_000,
      activeCampaigns: 1,
    } as AccountSummary),
  };

  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(makeFunnelData()),
    getBenchmarks: vi.fn().mockResolvedValue({
      leadToQualifiedRate: 0.4,
      qualifiedToBookingRate: 0.5,
      bookingToClosedRate: 0.25,
      leadToClosedRate: 0.06,
    } as FunnelBenchmarks),
  };

  const insightsProvider: CampaignInsightsProvider = {
    getCampaignLearningData: vi.fn().mockResolvedValue({
      effectiveStatus: "ACTIVE",
      learningPhase: false,
      lastModifiedDays: 14,
      optimizationEvents: 100,
    } as CampaignLearningInput),
    getTargetBreachStatus: vi.fn().mockResolvedValue({
      periodsAboveTarget: 0,
      granularity: "daily",
      isApproximate: false,
    } as TargetBreachResult),
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
  };
}

// ── Helper: build a runner tuned for tiering scenarios ──

function runnerWith(opts: {
  targetCostPerBooked?: number;
  bookings: number;
  conversions: number; // account = single campaign here
  campaignSpend: number;
  breachDays: number;
}) {
  const insight = makeCampaignInsight({
    campaignId: "c1",
    spend: opts.campaignSpend,
    conversions: opts.conversions,
    revenue: 0,
  });
  const deps = buildMockDeps({ currentInsights: [insight], previousInsights: [insight] });
  (deps.crmDataProvider.getFunnelData as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...makeFunnelData(),
    campaignIds: ["c1"],
    leads: opts.conversions,
    bookings: opts.bookings,
  });
  (deps.insightsProvider.getTargetBreachStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
    periodsAboveTarget: opts.breachDays,
    granularity: "daily",
    isApproximate: false,
  });
  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 50,
    targetROAS: 2,
    mediaBenchmarks: makeMediaBenchmarks(),
    ...(opts.targetCostPerBooked !== undefined
      ? { targetCostPerBooked: opts.targetCostPerBooked }
      : {}),
  };
  return new AuditRunner({ ...deps, config });
}

const RANGE = {
  dateRange: { since: "2026-05-25", until: "2026-06-01" },
  previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
};

describe("PR2 economic tiering", () => {
  it("Tier 1: booked-CAC calibration produces a pause and tags the rec", async () => {
    // CPL = 6000/30 = $200. bookings 10 / conv 30 = 0.333 → effectiveTargetCPL = 100×0.333 = $33.33.
    // CPL $200 > 3 × $33.33 ($100) → pause fires (daily breach present).
    const report = await runnerWith({
      targetCostPerBooked: 100,
      bookings: 10,
      conversions: 30,
      campaignSpend: 6000,
      breachDays: 9,
    }).run(RANGE);
    const pause = report.recommendations.find((r) => r.action === "pause");
    expect(pause).toBeDefined();
    expect(pause?.economicTier).toBe("booked_cac");
    expect(pause?.marginBasis).toBe("unavailable");
  });

  it("identical campaign metrics yield different recs when the account booking rate changes (account-level acceptance)", async () => {
    const common = {
      targetCostPerBooked: 100,
      conversions: 30,
      campaignSpend: 6000,
      breachDays: 9,
    };
    const poorBooking = await runnerWith({ ...common, bookings: 10 }).run(RANGE); // effTarget $33.3 → pause
    const healthyBooking = await runnerWith({ ...common, bookings: 30 }).run(RANGE); // rate 1.0 → effTarget $100, CPL $200 not > 3×100
    expect(poorBooking.recommendations.some((r) => r.action === "pause")).toBe(true);
    expect(healthyBooking.recommendations.some((r) => r.action === "pause")).toBe(false);
  });

  it("Tier 2 (no booked target): cpl basis, lowered confidence", async () => {
    const report = await runnerWith({
      bookings: 10,
      conversions: 40,
      campaignSpend: 8000,
      breachDays: 9, // CPL $200 vs targetCPA $50 → >3× → pause
    }).run(RANGE);
    const pause = report.recommendations.find((r) => r.action === "pause");
    expect(pause?.economicTier).toBe("cpl");
    expect(pause?.confidence).toBeCloseTo(0.9 - 0.15, 5);
  });

  it("Tier 3 (sparse leads): a would-be pause is withheld as a watch", async () => {
    const report = await runnerWith({
      bookings: 1,
      conversions: 10,
      campaignSpend: 6000,
      breachDays: 9, // < MIN_LEADS_FOR_TIER2, no booked target → cpc
    }).run(RANGE);
    expect(report.recommendations.some((r) => r.action === "pause")).toBe(false);
    expect(report.watches.some((w) => w.pattern.includes("cpc"))).toBe(true);
  });
});
