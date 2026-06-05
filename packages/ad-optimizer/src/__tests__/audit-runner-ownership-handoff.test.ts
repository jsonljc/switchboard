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
} from "@switchboard/schemas";

// Riley v3: ONE semantic end-to-end pin. A fatigued campaign produces
// refresh_creative and resolves to mira_handoff, proving the evidence flowed
// from the window insight (clicks/conversions/windowDays) through the
// runner-internal context map into the LIVE abstention gate, with and without
// a submitter wired.

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

/** camp-2, previous period: healthy engagement baseline. */
function makeFatiguePrevInsight(): CampaignInsight {
  return makeCampaignInsight({
    campaignId: "camp-2",
    campaignName: "Fatigued Campaign",
    impressions: 100_000,
    inlineLinkClicks: 3_000,
    spend: 5_000,
    conversions: 40,
    revenue: 8_000,
    frequency: 2.0,
    cpm: 50,
    inlineLinkClickCtr: 3.0,
    costPerInlineLinkClick: 1.67,
  });
}

/** camp-2, current period: creative_fatigue per metric-diagnostician RULES
 * (15% significance threshold): CTR 3.0 -> 1.8 (down 40%, significant);
 * frequency 2.0 -> 4.2 (up 110%, significant); CPM 50 -> 50 (not significant);
 * CPA 125 -> 142.9 (up, sub-threshold; rule needs direction up/stable only).
 * Evidence for the handoff gate: clicks 1_800 >= 10, conversions 35 >= 0,
 * windowDays 31 >= 3 (diagnostic floor), learningPhase false. */
function makeFatigueCurrentInsight(): CampaignInsight {
  return makeCampaignInsight({
    campaignId: "camp-2",
    campaignName: "Fatigued Campaign",
    impressions: 100_000,
    inlineLinkClicks: 1_800,
    spend: 5_000,
    conversions: 35,
    revenue: 7_000,
    frequency: 4.2,
    cpm: 50,
    inlineLinkClickCtr: 1.8,
    costPerInlineLinkClick: 2.78,
  });
}

function buildTwoCampaignDeps(): AuditDependencies {
  const deps = buildDeps();
  deps.adsClient.getCampaignInsights = vi
    .fn()
    // Current period first (Promise.all arg order): camp-1 breaches the target
    // (mutating recs); camp-2 is the creative-fatigue campaign.
    .mockResolvedValueOnce([
      makeCampaignInsight({ spend: 8_000, conversions: 35, revenue: 2_000 }),
      makeFatigueCurrentInsight(),
    ])
    .mockResolvedValueOnce([
      makeCampaignInsight({ spend: 4_800, conversions: 40, revenue: 12_000 }),
      makeFatiguePrevInsight(),
    ]);
  // camp-1 durably breaches; camp-2 does not (its recs stay purely
  // fatigue-driven so this pin is deterministic).
  deps.insightsProvider.getTargetBreachStatus = vi
    .fn()
    .mockImplementation((args: { campaignId: string }) =>
      Promise.resolve(
        args.campaignId === "camp-1"
          ? makeBreachingTargetBreach()
          : { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      ),
    );
  return deps;
}

describe("audit-runner ownership: end-to-end mira_handoff plumbing", () => {
  it("a fatigued campaign's refresh_creative resolves mira_handoff, submitter or not", async () => {
    for (const withSubmitter of [false, true]) {
      const deps = buildTwoCampaignDeps();
      const runner = new AuditRunner(
        withSubmitter
          ? {
              ...deps,
              recommendationEmitter: vi.fn(async () => ({
                surface: "queue" as const,
                id: "rec-1",
              })),
              recommendationEmissionContext: { cronId: "cron-test", deploymentId: "dep-1" },
              recommendationHandoffSubmitter: vi.fn(async () => undefined),
            }
          : deps,
      );
      const report = await runner.run(RANGE);
      const creativeIdx = report.recommendations.findIndex(
        (r) => r.action === "refresh_creative" && r.campaignId === "camp-2",
      );
      // Hard pin: the fatigue fixture MUST produce the creative rec; if the
      // diagnosis stops firing, fix the fixture against metric-diagnostician
      // RULES, never weaken this assertion.
      expect(creativeIdx, `submitter=${withSubmitter}`).toBeGreaterThanOrEqual(0);
      expect(report.ownership?.[creativeIdx]?.ownership).toBe("mira_handoff");
    }
  });
});
