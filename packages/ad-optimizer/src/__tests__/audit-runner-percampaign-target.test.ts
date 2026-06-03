// PR2 Gate-4 per-campaign target integration tests for AuditRunner.
// Verifies that each campaign is judged against its OWN booking-calibrated CAC
// (Tier-1) with the account-level target as the Tier-2 fallback, that the
// per-campaign target is the breach basis, and that `targetSource` is stamped.
import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import type { AuditDependencies, AdsClientInterface, AuditConfig } from "../audit-runner.js";
import type { RecommendationEmitter } from "../recommendation-sink.js";
import type { RecommendationInput } from "@switchboard/schemas";
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

// ── Minimal fixtures (the sibling audit-runner test files duplicate these by
// convention; there is no shared fixtures module) ──

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

function buildMockDeps(overrides: {
  currentInsights: CampaignInsight[];
  previousInsights: CampaignInsight[];
}): AuditDependencies {
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi
      .fn()
      .mockResolvedValueOnce(overrides.currentInsights)
      .mockResolvedValueOnce(overrides.previousInsights),
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

describe("AuditRunner PR2 Gate-4 per-campaign target", () => {
  it("judges each campaign on its OWN booked-CAC (Tier-1) — not the account-pooled target — and stamps targetSource=campaign", async () => {
    // c1 (strong booker): spend 6000, conv 30, booked 12 → own calibrate
    //   100 × 12/30 = $40. c2 (cheap leads): spend 700, conv 70, booked 2.
    // Account pools: conv 100, bookings 14 → calibrate 100 × 14/100 = $14.
    // So c1's per-campaign target ($40) DIFFERS from the account target ($14):
    // c1's breach detector must be called with 40, proving per-campaign wiring.
    const c1 = makeCampaignInsight({ campaignId: "c1", spend: 6000, conversions: 30, revenue: 0 });
    const c2 = makeCampaignInsight({ campaignId: "c2", spend: 700, conversions: 70, revenue: 0 });
    const deps = buildMockDeps({ currentInsights: [c1, c2], previousInsights: [c1, c2] });
    (deps.crmDataProvider.getFunnelData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeFunnelData(),
      campaignIds: ["c1", "c2"],
      leads: 100,
      bookings: 14,
      byCampaign: {
        c1: { received: 30, qualified: 20, booked: 12, showed: 0, paid: 0, revenue: 0 },
        c2: { received: 70, qualified: 10, booked: 2, showed: 0, paid: 0, revenue: 0 },
      },
    });
    (deps.insightsProvider.getTargetBreachStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      periodsAboveTarget: 9,
      granularity: "daily",
      isApproximate: false,
    });
    const config: AuditConfig = {
      accountId: "act-1",
      orgId: "org-1",
      targetCPA: 50,
      targetROAS: 2,
      targetCostPerBooked: 100,
      mediaBenchmarks: makeMediaBenchmarks(),
    };

    const report = await new AuditRunner({ ...deps, config }).run(RANGE);

    const c1Pause = report.recommendations.find(
      (r) => r.campaignId === "c1" && r.action === "pause",
    );
    expect(c1Pause?.economicTier).toBe("booked_cac");
    expect(c1Pause?.targetSource).toBe("campaign");
    // The breach basis is the campaign's OWN target ($40), never the account's ($14).
    expect(deps.insightsProvider.getTargetBreachStatus).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c1", targetCPA: 40 }),
    );
    expect(deps.insightsProvider.getTargetBreachStatus).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c2", targetCPA: 14 }),
    );
    // c2 fell below its booking floor (2 < 10) → any rec it produces must carry
    // the account fallback (vacuously true if c2 produces none — never fragile).
    expect(
      report.recommendations
        .filter((r) => r.campaignId === "c2")
        .every((r) => r.targetSource === "account"),
    ).toBe(true);
  });

  it("falls back to the account target (Tier-2) for a campaign below the booking floor and stamps targetSource=account", async () => {
    // c1: 3 booked (< MIN_BOOKED_FOR_TIER1 10) → per-campaign Tier-1 unavailable.
    // Account: 40 conversions ≥ MIN_LEADS_FOR_TIER2 → cpl tier vs targetCPA 50.
    const c1 = makeCampaignInsight({ campaignId: "c1", spend: 8000, conversions: 40, revenue: 0 });
    const deps = buildMockDeps({ currentInsights: [c1], previousInsights: [c1] });
    (deps.crmDataProvider.getFunnelData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeFunnelData(),
      campaignIds: ["c1"],
      leads: 40,
      bookings: 3,
      byCampaign: {
        c1: { received: 40, qualified: 10, booked: 3, showed: 0, paid: 0, revenue: 0 },
      },
    });
    (deps.insightsProvider.getTargetBreachStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      periodsAboveTarget: 9,
      granularity: "daily",
      isApproximate: false,
    });
    const config: AuditConfig = {
      accountId: "act-1",
      orgId: "org-1",
      targetCPA: 50,
      targetROAS: 2,
      targetCostPerBooked: 100,
      mediaBenchmarks: makeMediaBenchmarks(),
    };

    const report = await new AuditRunner({ ...deps, config }).run(RANGE);

    const pause = report.recommendations.find((r) => r.action === "pause");
    expect(pause?.economicTier).toBe("cpl");
    expect(pause?.targetSource).toBe("account");
    expect(deps.insightsProvider.getTargetBreachStatus).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c1", targetCPA: 50 }),
    );
  });
});

describe("AuditRunner PR2 Gate-4 campaignEconomics", () => {
  function depsWithByCampaign(): AuditDependencies {
    const insight = makeCampaignInsight({
      campaignId: "c1",
      spend: 400,
      conversions: 20,
      revenue: 0,
    });
    const deps = buildMockDeps({ currentInsights: [insight], previousInsights: [insight] });
    (deps.crmDataProvider.getFunnelData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeFunnelData(),
      campaignIds: ["c1"],
      leads: 20,
      bookings: 4,
      byCampaign: { c1: { received: 20, qualified: 8, booked: 4, showed: 0, paid: 0, revenue: 0 } },
    });
    return deps;
  }
  const baseConfig = (): AuditConfig => ({
    accountId: "act-1",
    orgId: "org-1",
    targetCPA: 50,
    targetROAS: 2,
    mediaBenchmarks: makeMediaBenchmarks(),
  });

  it("surfaces per-campaign trueROAS (cents→major normalized once) when the booked-value port is wired", async () => {
    const deps = depsWithByCampaign();
    const port = {
      queryBookedValueCentsByCampaign: vi.fn().mockResolvedValue(new Map([["c1", 90000]])),
    };
    const report = await new AuditRunner({
      ...deps,
      config: baseConfig(),
      bookedValueByCampaignProvider: port,
    }).run(RANGE);
    const row = report.campaignEconomics?.rows.find((r) => r.campaignId === "c1");
    expect(row?.costPerBooked).toBe(100); // spend 400 / booked 4
    expect(row?.bookedValueCents).toBe(90000);
    expect(row?.trueRoas).toBe(2.25); // ($900) / $400 — cents normalized only here
    expect(port.queryBookedValueCentsByCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", campaignIds: ["c1"] }),
    );
  });

  it("degrades gracefully when the booked-value port is absent (trueROAS null, no throw)", async () => {
    const deps = depsWithByCampaign();
    const report = await new AuditRunner({ ...deps, config: baseConfig() }).run(RANGE);
    const row = report.campaignEconomics?.rows.find((r) => r.campaignId === "c1");
    expect(row?.costPerBooked).toBe(100);
    expect(row?.bookedValueCents).toBeNull();
    expect(row?.trueRoas).toBeNull();
  });

  it("omits campaignEconomics when the CRM provider returns no per-campaign funnel", async () => {
    const insight = makeCampaignInsight({
      campaignId: "c1",
      spend: 400,
      conversions: 20,
      revenue: 0,
    });
    const deps = buildMockDeps({ currentInsights: [insight], previousInsights: [insight] });
    const report = await new AuditRunner({ ...deps, config: baseConfig() }).run(RANGE);
    expect(report.campaignEconomics).toBeUndefined();
  });
});

describe("AuditRunner PR2 Gate-4 — economic basis + per-campaign economics reach the emitted presentation", () => {
  it("threads campaignEconomics + targetSource through the sink into each rec's approval dataLines", async () => {
    // c1 strong booker: spend 6000, conv 30, booked 12, targetCostPerBooked 100
    // → per-campaign target $40 (Tier-1, booked_cac, targetSource=campaign), with a
    // breach (periodsAboveTarget 9) producing a pause rec. Booked-value port wired so
    // trueROAS is non-null. This locks the full audit-runner → sink → presentation
    // thread (the "computed-then-discarded" trap: the field is dropped unless the
    // audit-runner passes campaignEconomics into runRecommendationSink).
    const c1 = makeCampaignInsight({ campaignId: "c1", spend: 6000, conversions: 30, revenue: 0 });
    const deps = buildMockDeps({ currentInsights: [c1], previousInsights: [c1] });
    (deps.crmDataProvider.getFunnelData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeFunnelData(),
      campaignIds: ["c1"],
      leads: 30,
      bookings: 12,
      byCampaign: {
        c1: { received: 30, qualified: 20, booked: 12, showed: 0, paid: 0, revenue: 0 },
      },
    });
    (deps.insightsProvider.getTargetBreachStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      periodsAboveTarget: 9,
      granularity: "daily",
      isApproximate: false,
    });
    const captured: RecommendationInput[] = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      captured.push(input);
      return { surface: "queue" as const };
    });
    const config: AuditConfig = {
      accountId: "act-1",
      orgId: "org-1",
      targetCPA: 50,
      targetROAS: 2,
      targetCostPerBooked: 100,
      mediaBenchmarks: makeMediaBenchmarks(),
    };

    await new AuditRunner({
      ...deps,
      config,
      bookedValueByCampaignProvider: {
        // 1_200_000 cents = $12,000 booked value; trueROAS = 12000 / 6000 = 2.0
        queryBookedValueCentsByCampaign: vi.fn().mockResolvedValue(new Map([["c1", 1_200_000]])),
      },
      recommendationEmitter: emit,
      recommendationEmissionContext: { cronId: "cron-econ", deploymentId: "dep-1" },
    }).run(RANGE);

    const c1Pause = captured.find(
      (i) =>
        (i.targetEntities as { campaignId?: string } | null)?.campaignId === "c1" &&
        i.action === "pause",
    );
    expect(c1Pause, "expected a c1 pause recommendation to be emitted").toBeDefined();
    const flat = (c1Pause!.presentation.dataLines as unknown as string[][]).map((l) =>
      l.join(" · "),
    );
    // (a) basis: the campaign's own target judged it (Tier-1)
    expect(flat).toContain("Judged against this campaign's own booked-CAC target.");
    // (b) per-campaign economics: CPL 6000/30, cost-per-booked 6000/12, trueROAS 2.0
    expect(flat).toContain("CPL $200 · $500/booked · 2.0x true ROAS");
  });
});
