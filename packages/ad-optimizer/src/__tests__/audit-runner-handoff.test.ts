// Verifies AuditRunner's contribution to the Riley -> agent handoff seam: it builds
// a per-campaign evidence + learning-phase context map (from the SAME insights the
// engine judged) and threads it, with the injected submitter, into the sink. The
// sink's use of that map (firing the submitter for eligible creative recs) is
// covered in recommendation-sink.test.ts; here we mock the sink to assert the
// runner passes the right context.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../recommendation-sink.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../recommendation-sink.js")>();
  return {
    ...actual,
    runRecommendationSink: vi
      .fn()
      .mockResolvedValue({ routedQueue: 0, routedShadow: 0, dropped: 0 }),
  };
});

import { runRecommendationSink } from "../recommendation-sink.js";
import { AuditRunner } from "../audit-runner.js";
import type { AuditDependencies, AdsClientInterface, AuditConfig } from "../audit-runner.js";
import type { HandoffCampaignContext } from "../recommendation-handoff-dispatch.js";
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
    dateStart: "2026-05-26",
    dateStop: "2026-06-01",
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

function buildMockDeps(insights: CampaignInsight[]): AuditDependencies {
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi.fn().mockResolvedValueOnce(insights).mockResolvedValueOnce(insights),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
    getCampaign: vi.fn().mockResolvedValue({
      campaignId: "camp-1",
      name: "C",
      status: "ACTIVE",
      dailyBudgetCents: 5000,
    }),
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

// since = until - 6 days mirrors the production weekly window (7 inclusive days).
const RANGE = {
  dateRange: { since: "2026-05-26", until: "2026-06-01" },
  previousDateRange: { since: "2026-05-19", until: "2026-05-25" },
};

describe("AuditRunner — Riley -> agent handoff threading", () => {
  beforeEach(() => {
    (runRecommendationSink as ReturnType<typeof vi.fn>).mockClear();
  });

  it("threads the submitter and a per-campaign evidence/learning context map to the sink", async () => {
    const submitter = vi.fn(async () => {});
    const insight = makeCampaignInsight({
      campaignId: "camp-1",
      inlineLinkClicks: 320,
      conversions: 50,
    });
    await new AuditRunner({
      ...buildMockDeps([insight]),
      recommendationEmitter: vi.fn(async () => ({ surface: "queue" as const, id: "rec_1" })),
      recommendationEmissionContext: { cronId: "cron", deploymentId: "dep_riley" },
      recommendationHandoffSubmitter: submitter,
    }).run(RANGE);

    expect(runRecommendationSink).toHaveBeenCalledTimes(1);
    const sinkArgs = (runRecommendationSink as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sinkArgs.recommendationHandoffSubmitter).toBe(submitter);
    const ctx = sinkArgs.campaignEvidenceByCampaign as Map<string, HandoffCampaignContext>;
    expect(ctx.get("camp-1")).toEqual({
      evidence: { clicks: 320, conversions: 50, days: 7 },
      learningPhaseActive: false,
    });
  });

  it("does not thread handoff args when no submitter is configured (back-compat)", async () => {
    await new AuditRunner({
      ...buildMockDeps([makeCampaignInsight()]),
      recommendationEmitter: vi.fn(async () => ({ surface: "queue" as const, id: "rec_1" })),
      recommendationEmissionContext: { cronId: "cron", deploymentId: "dep_riley" },
    }).run(RANGE);

    const sinkArgs = (runRecommendationSink as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sinkArgs.recommendationHandoffSubmitter).toBeUndefined();
    expect(sinkArgs.campaignEvidenceByCampaign).toBeUndefined();
  });
});

describe("AuditRunner — Phase-C pause submitter threading", () => {
  beforeEach(() => {
    (runRecommendationSink as ReturnType<typeof vi.fn>).mockClear();
  });

  it("threads the pause submitter + evidence context even when the HANDOFF submitter is absent", async () => {
    const pauseSubmitter = vi.fn(async () => ({ parked: true }));
    const insight = makeCampaignInsight({
      campaignId: "camp-1",
      inlineLinkClicks: 320,
      conversions: 50,
    });
    await new AuditRunner({
      ...buildMockDeps([insight]),
      recommendationEmitter: vi.fn(async () => ({ surface: "queue" as const, id: "rec_1" })),
      recommendationEmissionContext: { cronId: "cron", deploymentId: "dep_riley" },
      rileyPauseSubmitter: pauseSubmitter,
    }).run(RANGE);

    const sinkArgs = (runRecommendationSink as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sinkArgs.rileyPauseSubmitter).toBe(pauseSubmitter);
    const ctx = sinkArgs.campaignEvidenceByCampaign as Map<string, HandoffCampaignContext>;
    expect(ctx.get("camp-1")).toEqual({
      evidence: { clicks: 320, conversions: 50, days: 7 },
      learningPhaseActive: false,
    });
  });

  it("pausePrimaryIndex is undefined when the arbitration primary is not a pause", async () => {
    // The default healthy fixture yields no pause recommendation, so whatever the
    // primary is (if any), it is not a pause; the sink must receive undefined and
    // therefore never dispatch the pause submitter (primary-only is structural).
    const pauseSubmitter = vi.fn(async () => ({ parked: true }));
    await new AuditRunner({
      ...buildMockDeps([makeCampaignInsight()]),
      recommendationEmitter: vi.fn(async () => ({ surface: "queue" as const, id: "rec_1" })),
      recommendationEmissionContext: { cronId: "cron", deploymentId: "dep_riley" },
      rileyPauseSubmitter: pauseSubmitter,
    }).run(RANGE);

    const sinkArgs = (runRecommendationSink as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sinkArgs.pausePrimaryIndex).toBeUndefined();
  });

  it("report ownership reads the sink's PARK FACT: riley_self at exactly the parked index", async () => {
    (runRecommendationSink as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      routedQueue: 2,
      routedShadow: 0,
      dropped: 0,
      pauseParkedIndex: 1,
    });
    const insight = makeCampaignInsight({
      campaignId: "camp-1",
      inlineLinkClicks: 320,
      conversions: 50,
      spend: 20_000,
    });
    const deps = buildMockDeps([insight]);
    (deps.insightsProvider.getTargetBreachStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      periodsAboveTarget: 8,
      granularity: "daily",
      isApproximate: false,
    });
    const report = await new AuditRunner({
      ...deps,
      recommendationEmitter: vi.fn(async () => ({ surface: "queue" as const, id: "rec_1" })),
      recommendationEmissionContext: { cronId: "cron", deploymentId: "dep_riley" },
      rileyPauseSubmitter: vi.fn(async () => ({ parked: true })),
    }).run(RANGE);

    const riley = report.ownership?.filter((o) => o.ownership === "riley_self") ?? [];
    expect(riley).toHaveLength(1);
    expect(riley[0]?.index).toBe(1);
  });

  it("no park fact (sink returns none) = no riley_self anywhere in the report", async () => {
    const insight = makeCampaignInsight({
      campaignId: "camp-1",
      inlineLinkClicks: 320,
      conversions: 50,
      spend: 20_000,
    });
    const deps = buildMockDeps([insight]);
    (deps.insightsProvider.getTargetBreachStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      periodsAboveTarget: 8,
      granularity: "daily",
      isApproximate: false,
    });
    const report = await new AuditRunner({
      ...deps,
      recommendationEmitter: vi.fn(async () => ({ surface: "queue" as const, id: "rec_1" })),
      recommendationEmissionContext: { cronId: "cron", deploymentId: "dep_riley" },
      rileyPauseSubmitter: vi.fn(async () => ({ parked: false })),
    }).run(RANGE);

    expect(report.ownership?.some((o) => o.ownership === "riley_self")).toBe(false);
  });

  it("pausePrimaryIndex points at the pause when the arbitrator ranks it primary", async () => {
    // CPA critically over target (spend 20000 / 50 conversions = 400 = 4x the 100
    // target) + a >=7-day daily breach window emits add_creative AND pause on the
    // same campaign; the same-campaign conflict penalty hits both equally and
    // add_creative additionally carries the resetsLearning penalty, so the
    // arbitrator ranks the PAUSE primary. This pins the real co-emission path the
    // initiator depends on.
    const pauseSubmitter = vi.fn(async () => ({ parked: true }));
    const insight = makeCampaignInsight({
      campaignId: "camp-1",
      inlineLinkClicks: 320,
      conversions: 50,
      spend: 20_000,
    });
    const deps = buildMockDeps([insight]);
    (deps.insightsProvider.getTargetBreachStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      periodsAboveTarget: 8,
      granularity: "daily",
      isApproximate: false,
    });
    await new AuditRunner({
      ...deps,
      recommendationEmitter: vi.fn(async () => ({ surface: "queue" as const, id: "rec_1" })),
      recommendationEmissionContext: { cronId: "cron", deploymentId: "dep_riley" },
      rileyPauseSubmitter: pauseSubmitter,
    }).run(RANGE);

    const sinkArgs = (runRecommendationSink as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sinkArgs.pausePrimaryIndex).toBeDefined();
    const recs = sinkArgs.recommendations as Array<{ action: string }>;
    expect(recs[sinkArgs.pausePrimaryIndex as number]!.action).toBe("pause");
  });
});

describe("AuditRunner — Spec-1B reallocate submitter threading (1B-1.6)", () => {
  beforeEach(() => {
    (runRecommendationSink as ReturnType<typeof vi.fn>).mockClear();
  });

  it("threads the budget submitter + frozen adAccountId to the sink when flag-on", async () => {
    const budgetSubmitter = vi.fn(async () => ({ parked: true }));
    await new AuditRunner({
      ...buildMockDeps([makeCampaignInsight({ campaignId: "camp-1" })]),
      recommendationEmitter: vi.fn(async () => ({ surface: "queue" as const, id: "rec_1" })),
      recommendationEmissionContext: { cronId: "cron", deploymentId: "dep_riley" },
      rileyBudgetSubmitter: budgetSubmitter,
    }).run(RANGE);

    const sinkArgs = (runRecommendationSink as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sinkArgs.rileyBudgetSubmitter).toBe(budgetSubmitter);
    expect(sinkArgs.adAccountId).toBe("act-123");
    // evidence context is threaded for the reallocate candidate too
    expect(sinkArgs.campaignEvidenceByCampaign).toBeDefined();
  });

  it("reads NO campaign budgets and threads no submitter when the flag is off (inert)", async () => {
    const deps = buildMockDeps([makeCampaignInsight()]);
    await new AuditRunner({
      ...deps,
      recommendationEmitter: vi.fn(async () => ({ surface: "queue" as const, id: "rec_1" })),
      recommendationEmissionContext: { cronId: "cron", deploymentId: "dep_riley" },
    }).run(RANGE);

    const sinkArgs = (runRecommendationSink as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sinkArgs.rileyBudgetSubmitter).toBeUndefined();
    // The flag-off path must make ZERO Meta budget reads (no current-budget pre-compute).
    expect(deps.adsClient.getCampaign).not.toHaveBeenCalled();
  });
});
