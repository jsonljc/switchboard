import { describe, it, expect } from "vitest";
import { AuditReportSchema, type CampaignInsightSchema } from "@switchboard/schemas";
import {
  evaluateDenominatorStepChange,
  buildSignalHealthCriticalReport,
  buildCoverageAbstentionReport,
} from "./audit-report-builders.js";

const DATE = { since: "2026-05-01", until: "2026-05-14" };

function ci(over: Partial<CampaignInsightSchema>): CampaignInsightSchema {
  return {
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 0,
    inlineLinkClicks: 0,
    spend: 0,
    conversions: 0,
    revenue: 0,
    frequency: 0,
    cpm: 0,
    inlineLinkClickCtr: 0,
    costPerInlineLinkClick: 0,
    dateStart: "",
    dateStop: "",
    ...over,
  };
}

describe("evaluateDenominatorStepChange", () => {
  it("trusts measurement when there is no rate collapse", () => {
    const r = evaluateDenominatorStepChange({
      currentInsights: [ci({ inlineLinkClicks: 1000, conversions: 55, spend: 1000 })],
      previousInsights: [ci({ inlineLinkClicks: 1000, conversions: 60, spend: 1000 })],
      nextCycleDate: "2026-05-21",
    });
    expect(r.measurementTrusted).toBe(true);
    expect(r.accountWatch).toBeUndefined();
  });

  it("flags untrusted + emits one account watch on a flat-clicks conversion-rate collapse", () => {
    const r = evaluateDenominatorStepChange({
      currentInsights: [ci({ inlineLinkClicks: 1000, conversions: 12, spend: 1000 })],
      previousInsights: [ci({ inlineLinkClicks: 1000, conversions: 60, spend: 1000 })],
      nextCycleDate: "2026-05-21",
    });
    expect(r.measurementTrusted).toBe(false);
    expect(r.accountWatch?.pattern).toBe("conversion_denominator_step_change");
    expect(r.accountWatch?.checkBackDate).toBe("2026-05-21");
  });

  it("sums totals across multiple campaigns before judging", () => {
    // Per-campaign rates look fine; only the ACCOUNT total collapses (flat clicks).
    const r = evaluateDenominatorStepChange({
      currentInsights: [
        ci({ inlineLinkClicks: 500, conversions: 6, spend: 500 }),
        ci({ inlineLinkClicks: 500, conversions: 6, spend: 500 }),
      ],
      previousInsights: [
        ci({ inlineLinkClicks: 500, conversions: 30, spend: 500 }),
        ci({ inlineLinkClicks: 500, conversions: 30, spend: 500 }),
      ],
      nextCycleDate: "2026-05-21",
    });
    expect(r.measurementTrusted).toBe(false);
  });

  it("flags untrusted on an account-wide CAPI outage (zero conversions both windows, real traffic)", () => {
    // The whole account drew real, flat traffic across both windows but reported ZERO
    // attributed conversions in both — the account-wide CAPI/pixel-outage signature.
    // Previously this read as TRUSTED (early-return on previous.conversions<=0) and
    // Riley could pause/scale on a broken signal; now it demotes to a watch.
    const r = evaluateDenominatorStepChange({
      currentInsights: [
        ci({ inlineLinkClicks: 300, conversions: 0, spend: 900 }),
        ci({ inlineLinkClicks: 200, conversions: 0, spend: 600 }),
      ],
      previousInsights: [
        ci({ inlineLinkClicks: 310, conversions: 0, spend: 930 }),
        ci({ inlineLinkClicks: 210, conversions: 0, spend: 620 }),
      ],
      nextCycleDate: "2026-05-21",
    });
    expect(r.measurementTrusted).toBe(false);
    expect(r.accountWatch?.pattern).toBe("conversion_denominator_step_change");
  });

  it("reports capiAttributionStale on the zero-conversions-despite-traffic outage signature", () => {
    const r = evaluateDenominatorStepChange({
      currentInsights: [ci({ inlineLinkClicks: 300, conversions: 0, spend: 900 })],
      previousInsights: [ci({ inlineLinkClicks: 310, conversions: 0, spend: 930 })],
      nextCycleDate: "2026-05-21",
    });
    expect(r.measurementTrusted).toBe(false);
    expect(r.capiAttributionStale).toBe(true);
  });

  it("does NOT report capiAttributionStale on a rate-collapse window shift (different remediation)", () => {
    const r = evaluateDenominatorStepChange({
      currentInsights: [ci({ inlineLinkClicks: 1000, conversions: 12, spend: 1000 })],
      previousInsights: [ci({ inlineLinkClicks: 1000, conversions: 60, spend: 1000 })],
      nextCycleDate: "2026-05-21",
    });
    expect(r.measurementTrusted).toBe(false);
    expect(r.capiAttributionStale).toBe(false);
  });

  it("does NOT report capiAttributionStale when measurement is trusted", () => {
    const r = evaluateDenominatorStepChange({
      currentInsights: [ci({ inlineLinkClicks: 1000, conversions: 55, spend: 1000 })],
      previousInsights: [ci({ inlineLinkClicks: 1000, conversions: 60, spend: 1000 })],
      nextCycleDate: "2026-05-21",
    });
    expect(r.measurementTrusted).toBe(true);
    expect(r.capiAttributionStale).toBe(false);
  });
});

describe("buildSignalHealthCriticalReport", () => {
  const rec = {
    type: "recommendation" as const,
    action: "fix_signal_health" as const,
    campaignId: "signal:px",
    campaignName: "px",
    confidence: 0.9,
    urgency: "immediate" as const,
    estimatedImpact: "pixel dead",
    steps: ["fix"],
    learningPhaseImpact: "no impact",
    resetsLearning: "no" as const,
  };

  it("computes overallROAS from totals, carries the signal-health recs, empties the rest", () => {
    const report = buildSignalHealthCriticalReport({
      accountId: "act_1",
      dateRange: DATE,
      totals: { totalSpend: 200, totalLeads: 4, totalRevenue: 600, activeCampaigns: 2 },
      signalHealthRecs: [rec],
    });
    expect(report.summary.overallROAS).toBe(3); // 600 / 200
    expect(report.summary.activeCampaigns).toBe(2);
    expect(report.recommendations).toEqual([rec]);
    expect(report.funnel).toEqual([]);
    expect(report.periodDeltas).toEqual([]);
    expect(report.insights).toEqual([]);
    expect(report.watches).toEqual([]);
    expect(AuditReportSchema.safeParse(report).success).toBe(true);
  });

  it("guards divide-by-zero (zero spend → ROAS 0)", () => {
    const report = buildSignalHealthCriticalReport({
      accountId: "act_1",
      dateRange: DATE,
      totals: { totalSpend: 0, totalLeads: 0, totalRevenue: 0, activeCampaigns: 0 },
      signalHealthRecs: [],
    });
    expect(report.summary.overallROAS).toBe(0);
  });
});

describe("buildCoverageAbstentionReport", () => {
  it("zeroes the summary, surfaces exactly one insight, no recs/watches (valid AuditReport)", () => {
    const insight = {
      type: "insight" as const,
      campaignId: "account",
      campaignName: "Account-wide signal",
      message: "Tracked-source coverage is 20% (below the 50% floor).",
      category: "coverage_insufficient",
    };
    const report = buildCoverageAbstentionReport({
      accountId: "act_1",
      dateRange: DATE,
      coverageInsight: insight,
    });
    expect(report.summary.totalSpend).toBe(0);
    expect(report.summary.overallROAS).toBe(0);
    expect(report.insights).toEqual([insight]);
    expect(report.recommendations).toEqual([]);
    expect(report.watches).toEqual([]);
    expect(AuditReportSchema.safeParse(report).success).toBe(true);
  });
});
