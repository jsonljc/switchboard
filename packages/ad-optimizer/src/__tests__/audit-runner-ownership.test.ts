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
import { emittedRiskContractFor } from "../recommendation-risk-contract.js";

// Riley v3 (spec 2.2 net-new item 1): the ownership annotation is ADDITIVE
// metadata over recommendations[]. This file pins the WIRING: total,
// index-faithful, tier-correct annotation; present without emitter/submitter;
// emission payloads unchanged; absent on both abort reports. The end-to-end
// mira_handoff semantic pin lives in audit-runner-ownership-handoff.test.ts.
// The sink-side context pin (audit-runner-handoff.test.ts:191) stays UNFLIPPED
// and that file UNMODIFIED.

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

/** Signal-health report fixture (transplanted from audit-runner.test.ts). */
function makeReport(overrides: {
  score: "red" | "yellow" | "green";
  breaches: Array<{
    signal:
      | "pixel_dead"
      | "server_to_browser_low"
      | "dedup_low"
      | "freshness_stale"
      | "da_check_failed";
    severity: "critical" | "warning";
    message: string;
  }>;
}) {
  return {
    pixelId: "px_1",
    score: overrides.score,
    pixelHealth: {
      pixelId: "px_1",
      name: "P",
      lastFiredAt: new Date().toISOString(),
      isUnavailable: false,
      automaticMatchingFields: ["em"],
      isDead: overrides.score === "red",
    },
    eventVolume: { events: [] },
    capiHealth: {
      serverToBrowserRatio: 0.95,
      dedupRate: 0.85,
      lastServerEventAt: new Date().toISOString(),
      freshnessMs: 60_000,
      isFresh: true,
    },
    daChecks: { checks: [], hasFailure: false },
    emqProxy: 0.85 * 0.95,
    breaches: overrides.breaches,
  };
}

const EMITTABLE = ["operator_swipe", "operator_approval", "mira_handoff", "human_escalation"];

describe("audit-runner ownership annotation (wiring)", () => {
  it("annotates every recommendation, index-faithful and tier-correct", async () => {
    const runner = new AuditRunner(buildDeps());
    const report = await runner.run(RANGE);

    // The breaching fixture must produce candidates or this test pins nothing.
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.ownership).toBeDefined();
    expect(report.ownership).toHaveLength(report.recommendations.length);

    report.ownership?.forEach((entry, i) => {
      const rec = report.recommendations[i]!;
      expect(entry.index).toBe(i);
      expect(entry.campaignId).toBe(rec.campaignId);
      expect(entry.action).toBe(rec.action);
      expect(EMITTABLE).toContain(entry.ownership); // riley_self never appears
      // D3 tier semantics re-derived from the rec's own fields (not an echo of
      // deriveOwnership: this pins the runner wired urgency + action correctly).
      const c = emittedRiskContractFor(rec.action, rec.urgency);
      if (entry.ownership === "mira_handoff") {
        expect(["refresh_creative", "add_creative"]).toContain(rec.action);
      } else if (c.financialEffect || c.externalEffect) {
        expect(entry.ownership).toBe(
          rec.urgency === "immediate" ? "human_escalation" : "operator_approval",
        );
      } else {
        expect(entry.ownership).toBe(
          rec.urgency === "next_cycle"
            ? "operator_swipe"
            : rec.urgency === "immediate"
              ? "human_escalation"
              : "operator_approval",
        );
      }
    });
  });

  it("derives ownership with NO emitter and NO submitter (annotation independent of the Mira wire)", async () => {
    const runner = new AuditRunner(buildDeps()); // analysis-only deps
    const report = await runner.run(RANGE);
    expect(report.ownership).toBeDefined();
    expect(report.ownership?.length).toBe(report.recommendations.length);
  });

  it("emission payloads carry no ownership key (additive: the sink never sees it)", async () => {
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
    expect(emitter).toHaveBeenCalledTimes(report.recommendations.length);
    for (const input of emitted) {
      expect(JSON.stringify(input)).not.toContain('"ownership"');
    }
  });

  it("abort reports carry no ownership field (Gate-0 coverage + signal-health red)", async () => {
    // Gate-0 coverage abstention.
    const gateDeps = buildDeps();
    const coverageValidator = {
      validate: vi.fn().mockResolvedValue({
        coveragePct: 0.2,
        bySource: {
          ctwa: { campaigns: 0, spend: 0, tracking: "missing_webhook" },
          web: { campaigns: 1, spend: 200, tracking: "no_recent_traffic" },
        },
      }),
    };
    const gateRunner = new AuditRunner({ ...gateDeps, coverageValidator });
    const gateReport = await gateRunner.run(RANGE);
    expect(gateReport.recommendations).toEqual([]);
    expect(gateReport.ownership).toBeUndefined();

    // Signal-health red short-circuit (makeReport transplanted from
    // audit-runner.test.ts signal-health describe).
    const redDeps = buildDeps();
    const checker = {
      getSignalHealthReport: vi.fn().mockResolvedValue(
        makeReport({
          score: "red",
          breaches: [{ signal: "pixel_dead", severity: "critical", message: "Pixel dead." }],
        }),
      ),
    };
    const redRunner = new AuditRunner({
      ...redDeps,
      signalHealthChecker: checker as never,
      config: { ...redDeps.config, pixelId: "px_1" },
    });
    const redReport = await redRunner.run(RANGE);
    expect(redReport.ownership).toBeUndefined();
  });
});
