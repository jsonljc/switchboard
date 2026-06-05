import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import type {
  AuditDependencies,
  AdsClientInterface,
  AuditConfig,
  BookedValueByCampaignProvider,
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
  TargetBreachResult,
  RecommendationInput,
} from "@switchboard/schemas";
import { isMutating } from "../action-contract.js";

// Riley v3 slice 2: the arbitration annotation is ADDITIVE ranking metadata. These
// integration tests pin (a) faithful indices into recommendations[] on the happy
// path, (b) emission unchanged (every candidate emitted, no arbitration key in any
// payload), and (c) no arbitration field on abort reports.

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

/** Durable daily breach so the per-campaign decision yields mutating recs. */
function makeBreachingTargetBreach(): TargetBreachResult {
  return { periodsAboveTarget: 9, granularity: "daily", isApproximate: false };
}

function buildDeps(): AuditDependencies {
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi
      .fn()
      // Current period: expensive (high spend per conversion) to breach the target,
      // with conversions >= 30 so the account keeps the cpl tier (MIN_LEADS_FOR_TIER2;
      // the cpc tier would suppress cost-driven recs and the fixture would pin nothing).
      .mockResolvedValueOnce([
        makeCampaignInsight({ spend: 8_000, conversions: 35, revenue: 2_000 }),
      ])
      .mockResolvedValueOnce([
        makeCampaignInsight({ spend: 4_800, conversions: 40, revenue: 12_000 }),
      ]),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
  };
  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(makeFunnelData()),
    getBenchmarks: vi.fn().mockResolvedValue(makeCrmBenchmarks()),
  };
  const insightsProvider: CampaignInsightsProvider = {
    getCampaignLearningData: vi.fn().mockResolvedValue(makeLearningInput()),
    getTargetBreachStatus: vi.fn().mockResolvedValue(makeBreachingTargetBreach()),
  };
  const bookedValueProvider: BookedValueByCampaignProvider = {
    queryBookedValueCentsByCampaign: vi.fn().mockResolvedValue(new Map<string, number>()),
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
    bookedValueByCampaignProvider: bookedValueProvider,
  };
}

const RANGE = {
  dateRange: { since: "2026-03-01", until: "2026-03-31" },
  previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
};

describe("AuditRunner arbitration (additive ranking metadata)", () => {
  it("annotates arbitration on the report without changing recommendations or emission", async () => {
    const deps = buildDeps();
    const emitted: RecommendationInput[] = [];
    const emitter = vi.fn(async (input: RecommendationInput) => {
      emitted.push(input);
      return { surface: "queue" as const };
    });
    const runner = new AuditRunner({
      ...deps,
      recommendationEmitter: emitter,
      recommendationEmissionContext: { cronId: "cron-test" },
    });
    const report = await runner.run(RANGE);

    // The breaching fixture must produce at least one recommendation, or this
    // test pins nothing; fail loudly rather than vacuously pass.
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.arbitration).toBeDefined();

    const ranked = [
      ...(report.arbitration?.primary ? [report.arbitration.primary] : []),
      ...(report.arbitration?.secondary ?? []),
    ];
    // Every ranked entry indexes a real mutating recommendation, faithfully.
    for (const entry of ranked) {
      const rec = report.recommendations[entry.index];
      expect(rec).toBeDefined();
      expect(rec?.campaignId).toBe(entry.campaignId);
      expect(rec?.action).toBe(entry.action);
      expect(isMutating(rec!.action)).toBe(true);
    }
    // Exactly the mutating candidates are ranked (primary + secondary partition them).
    const mutatingCount = report.recommendations.filter((r) => isMutating(r.action)).length;
    expect(ranked.length).toBe(mutatingCount);
    if (mutatingCount > 0) {
      expect(report.arbitration?.primary).toBeDefined();
    }

    // Emission unchanged: every candidate emitted (unfiltered), no arbitration key
    // in any emitted payload.
    expect(emitter).toHaveBeenCalledTimes(report.recommendations.length);
    for (const input of emitted) {
      expect(Object.keys(input)).not.toContain("arbitration");
    }
  });

  it("analysis-only callers (no emitter) still get the arbitration annotation", async () => {
    const runner = new AuditRunner(buildDeps());
    const report = await runner.run(RANGE);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.arbitration).toBeDefined();
  });

  it("abort paths carry no arbitration field (Gate-0 coverage abstention)", async () => {
    const deps = buildDeps();
    const coverageValidator = {
      validate: vi.fn().mockResolvedValue({
        coveragePct: 0.2,
        bySource: {
          ctwa: { campaigns: 0, spend: 0, tracking: "missing_webhook" },
          web: { campaigns: 1, spend: 200, tracking: "no_recent_traffic" },
        },
      }),
    };
    const runner = new AuditRunner({ ...deps, coverageValidator });
    const report = await runner.run(RANGE);
    expect(report.recommendations).toEqual([]);
    expect(report.arbitration).toBeUndefined();
  });
});
