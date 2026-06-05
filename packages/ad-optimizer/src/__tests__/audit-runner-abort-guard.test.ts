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
import type { CoverageReport } from "../onboarding/coverage-validator.js";
import { decideForCampaign } from "../campaign-decision.js";

// Slice 4c: partial passthrough mock; the freshness seam test reads the
// RevenueState handed to the per-campaign decision. Wraps the REAL
// implementation, so all other tests in this file behave identically.
vi.mock("../campaign-decision.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../campaign-decision.js")>();
  return { ...actual, decideForCampaign: vi.fn(actual.decideForCampaign) };
});

// Asymmetric abort-guard (spec 7.3 / Riley v3 slice 1). RevenueState is assembled
// PROGRESSIVELY on the post-abort happy path; no late producer may run past an abort.
// Provider call counts are the assertion surface; resolveEconomicTarget is proven
// not-called by control flow (it sits after getFunnelData, which must be uncalled).

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

function makeTargetBreach(): TargetBreachResult {
  return { periodsAboveTarget: 0, granularity: "daily", isApproximate: false };
}

function makeSignalReport(score: "red" | "yellow" | "green") {
  return {
    pixelId: "px_1",
    score,
    pixelHealth: {
      pixelId: "px_1",
      name: "P",
      lastFiredAt: new Date().toISOString(),
      isUnavailable: false,
      automaticMatchingFields: ["em"],
      isDead: score === "red",
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
    breaches:
      score === "red"
        ? [{ signal: "pixel_dead" as const, severity: "critical" as const, message: "dead" }]
        : [],
  };
}

function buildSpiedDeps(): {
  deps: AuditDependencies;
  adsClient: AdsClientInterface;
  crmDataProvider: CrmDataProvider;
  insightsProvider: CampaignInsightsProvider;
  bookedValueProvider: BookedValueByCampaignProvider;
  operationalStateProvider: { getLatest: ReturnType<typeof vi.fn> };
} {
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi
      .fn()
      .mockResolvedValueOnce([makeCampaignInsight()])
      .mockResolvedValueOnce([makeCampaignInsight({ spend: 4_800 })]),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
  };
  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(makeFunnelData()),
    getBenchmarks: vi.fn().mockResolvedValue(makeCrmBenchmarks()),
  };
  const insightsProvider: CampaignInsightsProvider = {
    getCampaignLearningData: vi.fn().mockResolvedValue(makeLearningInput()),
    getTargetBreachStatus: vi.fn().mockResolvedValue(makeTargetBreach()),
  };
  const bookedValueProvider: BookedValueByCampaignProvider = {
    queryBookedValueCentsByCampaign: vi.fn().mockResolvedValue(new Map<string, number>()),
  };
  const operationalStateProvider = {
    getLatest: vi.fn().mockResolvedValue({ confirmedAt: new Date("2026-03-25T00:00:00.000Z") }),
  };
  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 100,
    targetROAS: 3.0,
    mediaBenchmarks: makeMediaBenchmarks(),
  };
  const deps: AuditDependencies = {
    adsClient,
    crmDataProvider,
    insightsProvider,
    config,
    bookedValueByCampaignProvider: bookedValueProvider,
    operationalStateProvider,
  };
  return {
    deps,
    adsClient,
    crmDataProvider,
    insightsProvider,
    bookedValueProvider,
    operationalStateProvider,
  };
}

const RANGE = {
  dateRange: { since: "2026-03-01", until: "2026-03-31" },
  previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
};

describe("AuditRunner abort-guard (RevenueState progressive assembly)", () => {
  it("Gate-0 coverage abstention calls ZERO downstream providers", async () => {
    const {
      deps,
      adsClient,
      crmDataProvider,
      insightsProvider,
      bookedValueProvider,
      operationalStateProvider,
    } = buildSpiedDeps();
    const insufficient: CoverageReport = {
      coveragePct: 0.2,
      bySource: {
        ctwa: { campaigns: 0, spend: 0, tracking: "missing_webhook" },
        instant_form: { campaigns: 0, spend: 0, tracking: "missing_webhook" },
        web: { campaigns: 1, spend: 200, tracking: "no_recent_traffic" },
      },
    };
    const coverageValidator = { validate: vi.fn().mockResolvedValue(insufficient) };
    const runner = new AuditRunner({ ...deps, coverageValidator });

    const report = await runner.run(RANGE);

    // Abstention report shape (no recs).
    expect(report.recommendations).toEqual([]);
    expect(coverageValidator.validate).toHaveBeenCalledTimes(1);
    // ZERO providers past the gate: no Meta fetch, no CRM funnel, no per-campaign, no booked-value.
    expect(adsClient.getCampaignInsights).not.toHaveBeenCalled();
    expect(adsClient.getAccountSummary).not.toHaveBeenCalled();
    expect(crmDataProvider.getFunnelData).not.toHaveBeenCalled();
    expect(insightsProvider.getCampaignLearningData).not.toHaveBeenCalled();
    expect(insightsProvider.getTargetBreachStatus).not.toHaveBeenCalled();
    expect(bookedValueProvider.queryBookedValueCentsByCampaign).not.toHaveBeenCalled();
    // Slice 4c: the operational-state read is a post-abort producer.
    expect(operationalStateProvider.getLatest).not.toHaveBeenCalled();
  });

  it("signal-health-red runs ONLY the Meta insight fetches, then aborts before late producers", async () => {
    const {
      deps,
      adsClient,
      crmDataProvider,
      insightsProvider,
      bookedValueProvider,
      operationalStateProvider,
    } = buildSpiedDeps();
    const checker = {
      getSignalHealthReport: vi.fn().mockResolvedValue(makeSignalReport("red")),
    };
    const runner = new AuditRunner({
      ...deps,
      signalHealthChecker: checker as never,
      config: { ...deps.config, pixelId: "px_1" },
    });

    await runner.run(RANGE);

    // Meta insight fetches DID run (they feed the critical report's totals, not skippable).
    expect(adsClient.getCampaignInsights).toHaveBeenCalledTimes(2);
    expect(adsClient.getAccountSummary).toHaveBeenCalledTimes(1);
    // But every LATE producer is skipped: CRM funnel (which gates resolveEconomicTarget),
    // per-campaign decisions, spend-attribution, booked-value.
    expect(crmDataProvider.getFunnelData).not.toHaveBeenCalled();
    expect(insightsProvider.getCampaignLearningData).not.toHaveBeenCalled();
    expect(insightsProvider.getTargetBreachStatus).not.toHaveBeenCalled();
    expect(bookedValueProvider.queryBookedValueCentsByCampaign).not.toHaveBeenCalled();
    // Slice 4c: skipped at this abort too (it sits with the late producers).
    expect(operationalStateProvider.getLatest).not.toHaveBeenCalled();
  });

  it("happy path (no abort) runs Meta fetches, CRM funnel, and per-campaign decisions", async () => {
    const { deps, adsClient, crmDataProvider, insightsProvider, operationalStateProvider } =
      buildSpiedDeps();
    const runner = new AuditRunner(deps);

    await runner.run(RANGE);

    expect(adsClient.getCampaignInsights).toHaveBeenCalledTimes(2);
    expect(crmDataProvider.getFunnelData).toHaveBeenCalledTimes(1);
    expect(insightsProvider.getCampaignLearningData).toHaveBeenCalledTimes(1);
    expect(insightsProvider.getTargetBreachStatus).toHaveBeenCalledTimes(1);
    // Slice 4c: read exactly once on the happy path, keyed by the org.
    expect(operationalStateProvider.getLatest).toHaveBeenCalledTimes(1);
    expect(operationalStateProvider.getLatest).toHaveBeenCalledWith("org-1");
  });

  it("completes the audit with freshness degraded when the operational-state read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps, operationalStateProvider } = buildSpiedDeps();
    operationalStateProvider.getLatest.mockRejectedValue(new Error("db down"));
    const runner = new AuditRunner(deps);

    const report = await runner.run(RANGE);

    // The weekly audit must not sink on an advisory read: report still produced.
    expect(report.accountId).toBe("act-123");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("threads the DERIVED freshness into the RevenueState the decision layer reads (seam pin)", async () => {
    const { deps, operationalStateProvider } = buildSpiedDeps();
    // Relative to the runner's real clock: 370 days old is unambiguously
    // past the 14-day vouch window. "stale" discriminates against BOTH
    // failure modes: a dropped value (would default "unknown") and a
    // hardcoded constant (would read "fresh"/"unknown").
    operationalStateProvider.getLatest.mockResolvedValue({
      confirmedAt: new Date(Date.now() - 370 * 24 * 60 * 60 * 1000),
    });
    const decideMock = vi.mocked(decideForCampaign);
    decideMock.mockClear();
    const runner = new AuditRunner(deps);

    await runner.run(RANGE);

    expect(decideMock).toHaveBeenCalledTimes(1);
    expect(decideMock.mock.calls[0]?.[0]?.revenueState.businessContextFreshness).toBe("stale");
  });
});
