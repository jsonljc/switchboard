// packages/core/src/ad-optimizer/__tests__/audit-runner.test.ts
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

// ── Fixtures ──

function makeCampaignInsight(overrides: Partial<CampaignInsight> = {}): CampaignInsight {
  return {
    campaignId: "camp-1",
    campaignName: "Test Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 100_000,
    clicks: 2_000,
    spend: 5_000,
    conversions: 50,
    revenue: 15_000,
    frequency: 2.5,
    cpm: 50,
    ctr: 2.0,
    cpc: 2.5,
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
    activeCampaigns: 2,
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
  return { ctr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 };
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

// ── Mock dependencies builder ──

function buildMockDeps(
  overrides: {
    currentInsights?: CampaignInsight[];
    previousInsights?: CampaignInsight[];
  } = {},
): AuditDependencies {
  const currentInsights = overrides.currentInsights ?? [makeCampaignInsight()];
  const previousInsights = overrides.previousInsights ?? [
    makeCampaignInsight({
      spend: 4_800,
      impressions: 95_000,
      clicks: 1_900,
      conversions: 48,
      revenue: 14_400,
      frequency: 2.3,
      cpm: 50.5,
      ctr: 2.0,
      cpc: 2.53,
    }),
  ];

  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi
      .fn()
      .mockResolvedValueOnce(currentInsights)
      .mockResolvedValueOnce(previousInsights),
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
    getAdSetInsights: vi.fn().mockResolvedValue([
      {
        adSetId: "adset-1",
        adSetName: "Test Ad Set",
        campaignId: "camp-1",
        learningStageStatus: "SUCCESS" as const,
        frequency: 1.5,
        spend: 5000,
        conversions: 50,
        cpa: 100,
        roas: 3.0,
        ctr: 2.0,
      },
    ]),
    getTrendData: vi.fn().mockResolvedValue({
      day30: { cpm: 50, ctr: 2.0, cpc: 2.5, cpl: 100, cpa: 100, roas: 3.0 },
      day60: { cpm: 48, ctr: 2.1, cpc: 2.4, cpl: 95, cpa: 95, roas: 3.1 },
      day90: { cpm: 45, ctr: 2.2, cpc: 2.3, cpl: 90, cpa: 90, roas: 3.2 },
      weekly: [
        { cpm: 48, ctr: 2.1, cpc: 2.4, cpl: 95, cpa: 95, roas: 3.1 },
        { cpm: 49, ctr: 2.0, cpc: 2.5, cpl: 98, cpa: 98, roas: 3.0 },
        { cpm: 50, ctr: 2.0, cpc: 2.5, cpl: 100, cpa: 100, roas: 3.0 },
        { cpm: 51, ctr: 1.9, cpc: 2.6, cpl: 102, cpa: 102, roas: 2.9 },
      ],
    }),
  };
}

// ── Tests ──

describe("AuditRunner", () => {
  it("produces a complete audit report", async () => {
    const deps = buildMockDeps();
    const runner = new AuditRunner(deps);

    const report = await runner.run({
      dateRange: { since: "2026-03-01", until: "2026-03-31" },
      previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
    });

    // Structure checks
    expect(report.accountId).toBe("act-123");
    expect(report.dateRange).toEqual({ since: "2026-03-01", until: "2026-03-31" });
    expect(report.summary).toBeDefined();
    expect(report.funnel).toBeDefined();
    expect(Array.isArray(report.funnel)).toBe(true);
    expect(report.funnel).toHaveLength(1);
    expect(report.funnel[0]!.stages).toHaveLength(6);
    expect(report.funnel[0]!.funnelShape).toBe("website");
    expect(report.periodDeltas).toBeDefined();
    expect(Array.isArray(report.insights)).toBe(true);
    expect(Array.isArray(report.watches)).toBe(true);
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  it("populates summary from campaign data", async () => {
    const insight1 = makeCampaignInsight({
      campaignId: "camp-1",
      spend: 5_000,
      conversions: 50,
      revenue: 15_000,
    });
    const insight2 = makeCampaignInsight({
      campaignId: "camp-2",
      spend: 3_000,
      conversions: 30,
      revenue: 9_000,
    });

    const deps = buildMockDeps({
      currentInsights: [insight1, insight2],
      previousInsights: [
        makeCampaignInsight({ campaignId: "camp-1", spend: 4_500 }),
        makeCampaignInsight({ campaignId: "camp-2", spend: 2_800 }),
      ],
    });
    const runner = new AuditRunner(deps);

    const report = await runner.run({
      dateRange: { since: "2026-03-01", until: "2026-03-31" },
      previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
    });

    expect(report.summary.totalSpend).toBe(8_000);
    expect(report.summary.totalLeads).toBe(80); // 50 + 30 conversions
    expect(report.summary.totalRevenue).toBe(24_000);
    expect(report.summary.activeCampaigns).toBe(2);
  });

  it("generates insight for stable well-performing campaign", async () => {
    // CPA=100, target=100 (at target), ROAS=3.0, target=3.0 (at target)
    const insight = makeCampaignInsight({
      campaignId: "camp-stable",
      campaignName: "Stable Winner",
      spend: 5_000,
      conversions: 50,
      revenue: 15_000, // ROAS = 3.0
    });

    const prevInsight = makeCampaignInsight({
      campaignId: "camp-stable",
      campaignName: "Stable Winner",
      spend: 5_000,
      conversions: 50,
      revenue: 15_000, // identical = no deltas, stable
    });

    const deps = buildMockDeps({
      currentInsights: [insight],
      previousInsights: [prevInsight],
    });
    // targetCPA=100 (CPA = 5000/50 = 100), targetROAS=3.0 (ROAS = 15000/5000 = 3.0)
    deps.config.targetCPA = 100;
    deps.config.targetROAS = 3.0;

    const runner = new AuditRunner(deps);
    const report = await runner.run({
      dateRange: { since: "2026-03-01", until: "2026-03-31" },
      previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
    });

    // Should produce an insight (not a recommendation) for a stable, well-performing campaign
    const stableInsight = report.insights.find((i) => i.campaignId === "camp-stable");
    expect(stableInsight).toBeDefined();
    expect(stableInsight!.type).toBe("insight");
    expect(stableInsight!.message).toContain("ROAS");
    expect(stableInsight!.message).toContain("No changes recommended");
  });

  it("includes adSetDetails in audit report", async () => {
    const deps = buildMockDeps();
    const runner = new AuditRunner(deps);

    const report = await runner.run({
      dateRange: { since: "2026-03-01", until: "2026-03-31" },
      previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
    });

    expect(report.adSetDetails).toBeDefined();
    expect(report.adSetDetails).toHaveLength(1);
    expect(report.adSetDetails![0]!.adSetId).toBe("adset-1");
    expect(report.adSetDetails![0]!.learningStatus.state).toBe("success");
  });

  it("includes trends in audit report", async () => {
    const deps = buildMockDeps();
    const runner = new AuditRunner(deps);

    const report = await runner.run({
      dateRange: { since: "2026-03-01", until: "2026-03-31" },
      previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
    });

    expect(report.trends).toBeDefined();
    expect(report.trends!.rollingAverages.day30).toBeDefined();
    expect(report.trends!.rollingAverages.day60).toBeDefined();
    expect(report.trends!.rollingAverages.day90).toBeDefined();
    expect(Array.isArray(report.trends!.trends)).toBe(true);
  });

  it("includes budgetDistribution in audit report", async () => {
    const deps = buildMockDeps({
      currentInsights: [
        makeCampaignInsight({
          campaignId: "camp-1",
          spend: 5_000,
          conversions: 50,
          revenue: 15_000,
        }),
        makeCampaignInsight({
          campaignId: "camp-2",
          spend: 3_000,
          conversions: 30,
          revenue: 9_000,
        }),
      ],
      previousInsights: [
        makeCampaignInsight({ campaignId: "camp-1", spend: 4_500 }),
        makeCampaignInsight({ campaignId: "camp-2", spend: 2_800 }),
      ],
    });
    const runner = new AuditRunner(deps);

    const report = await runner.run({
      dateRange: { since: "2026-03-01", until: "2026-03-31" },
      previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
    });

    expect(report.budgetDistribution).toBeDefined();
    expect(report.budgetDistribution!.entries).toHaveLength(2);
    expect(report.budgetDistribution!.currency).toBe("USD");
  });

  it("returns funnel as array with detected shapes", async () => {
    const deps = buildMockDeps();
    // Mock ad sets with different destination types
    (deps.getAdSetInsights as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        adSetId: "adset-1",
        adSetName: "Website Ad Set",
        campaignId: "camp-1",
        learningStageStatus: "SUCCESS" as const,
        frequency: 1.5,
        spend: 3000,
        conversions: 30,
        cpa: 100,
        roas: 3.0,
        ctr: 2.0,
        destinationType: "WEBSITE",
      },
      {
        adSetId: "adset-2",
        adSetName: "Instant Form Ad Set",
        campaignId: "camp-1",
        learningStageStatus: "SUCCESS" as const,
        frequency: 2.0,
        spend: 2000,
        conversions: 20,
        cpa: 100,
        roas: 3.0,
        ctr: 2.0,
        destinationType: "ON_AD",
      },
    ]);

    const runner = new AuditRunner(deps);
    const report = await runner.run({
      dateRange: { since: "2026-03-01", until: "2026-03-31" },
      previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
    });

    expect(Array.isArray(report.funnel)).toBe(true);
    // At minimum the default website funnel from analyzeFunnel
    expect(report.funnel.length).toBeGreaterThanOrEqual(1);
    expect(report.funnel[0]!.funnelShape).toBeDefined();
  });

  it("tracks adSetsInLearning and adSetsLearningLimited in summary", async () => {
    const deps = buildMockDeps();
    (deps.getAdSetInsights as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        adSetId: "adset-1",
        adSetName: "Learning Ad Set",
        campaignId: "camp-1",
        learningStageStatus: "LEARNING" as const,
        frequency: 1.5,
        spend: 2000,
        conversions: 20,
        cpa: 100,
        roas: 3.0,
        ctr: 2.0,
      },
      {
        adSetId: "adset-2",
        adSetName: "Limited Ad Set",
        campaignId: "camp-1",
        learningStageStatus: "FAIL" as const,
        frequency: 4.0,
        spend: 3000,
        conversions: 30,
        cpa: 100,
        roas: 3.0,
        ctr: 2.0,
      },
      {
        adSetId: "adset-3",
        adSetName: "Stable Ad Set",
        campaignId: "camp-1",
        learningStageStatus: "SUCCESS" as const,
        frequency: 1.5,
        spend: 5000,
        conversions: 50,
        cpa: 100,
        roas: 3.0,
        ctr: 2.0,
      },
    ]);

    const runner = new AuditRunner(deps);
    const report = await runner.run({
      dateRange: { since: "2026-03-01", until: "2026-03-31" },
      previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
    });

    expect(report.summary.adSetsInLearning).toBe(1);
    expect(report.summary.adSetsLearningLimited).toBe(1);
  });
});
