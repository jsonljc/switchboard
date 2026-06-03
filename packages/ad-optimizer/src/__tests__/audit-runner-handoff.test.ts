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
    const ctx = sinkArgs.handoffContextByCampaign as Map<string, HandoffCampaignContext>;
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
    expect(sinkArgs.handoffContextByCampaign).toBeUndefined();
  });
});
