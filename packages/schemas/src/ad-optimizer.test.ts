import { describe, it, expect } from "vitest";
import {
  RecommendationOutputSchema,
  EconomicTierSchema,
  MarginBasisSchema,
  AuditReportSchema,
} from "./ad-optimizer.js";

const base = {
  type: "recommendation" as const,
  action: "pause" as const,
  campaignId: "c1",
  campaignName: "C1",
  confidence: 0.9,
  urgency: "immediate" as const,
  estimatedImpact: "x",
  steps: ["a"],
  learningPhaseImpact: "no impact",
  resetsLearning: "no" as const,
};

describe("RecommendationOutputSchema economic fields", () => {
  it("parses without the new fields (back-compat)", () => {
    expect(RecommendationOutputSchema.parse(base).economicTier).toBeUndefined();
  });
  it("parses with economicTier + marginBasis", () => {
    const r = RecommendationOutputSchema.parse({
      ...base,
      economicTier: "booked_cac",
      marginBasis: "unavailable",
    });
    expect(r.economicTier).toBe("booked_cac");
    expect(r.marginBasis).toBe("unavailable");
  });
  it("rejects an unknown economic tier", () => {
    expect(() => RecommendationOutputSchema.parse({ ...base, economicTier: "roas" })).toThrow();
  });
  it("exposes the enums", () => {
    expect(EconomicTierSchema.options).toEqual(["booked_cac", "cpl", "cpc"]);
    expect(MarginBasisSchema.options).toEqual(["configured", "unavailable"]);
  });

  it("RecommendationOutput requires a resetsLearning class", () => {
    const withoutResets = {
      type: "recommendation" as const,
      action: "scale" as const,
      campaignId: "c",
      campaignName: "C",
      confidence: 0.7,
      urgency: "this_week" as const,
      estimatedImpact: "x",
      steps: ["x"],
      learningPhaseImpact: "no impact",
    };
    expect(RecommendationOutputSchema.safeParse(withoutResets).success).toBe(false);
    expect(
      RecommendationOutputSchema.safeParse({ ...withoutResets, resetsLearning: "no" }).success,
    ).toBe(true);
  });
});

describe("RecommendationOutputSchema targetSource (PR2 Gate-4)", () => {
  it("parses without targetSource (back-compat)", () => {
    expect(RecommendationOutputSchema.parse(base).targetSource).toBeUndefined();
  });
  it("parses targetSource campaign|account", () => {
    expect(
      RecommendationOutputSchema.parse({ ...base, targetSource: "campaign" }).targetSource,
    ).toBe("campaign");
    expect(
      RecommendationOutputSchema.parse({ ...base, targetSource: "account" }).targetSource,
    ).toBe("account");
  });
  it("rejects an unknown targetSource", () => {
    expect(() => RecommendationOutputSchema.parse({ ...base, targetSource: "global" })).toThrow();
  });
});

describe("AuditReportSchema campaignEconomics (PR2 Gate-4)", () => {
  const baseReport = {
    accountId: "act-1",
    dateRange: { since: "2026-05-25", until: "2026-06-01" },
    summary: {
      totalSpend: 0,
      totalLeads: 0,
      totalRevenue: 0,
      overallROAS: 0,
      activeCampaigns: 0,
      campaignsInLearning: 0,
      adSetsInLearning: 0,
      adSetsLearningLimited: 0,
    },
    funnel: [],
    periodDeltas: [],
    insights: [],
    watches: [],
    recommendations: [],
  };
  it("parses without campaignEconomics (back-compat)", () => {
    expect(AuditReportSchema.parse(baseReport).campaignEconomics).toBeUndefined();
  });
  it("parses campaignEconomics rows with nullable metrics", () => {
    const r = AuditReportSchema.parse({
      ...baseReport,
      campaignEconomics: {
        rows: [
          { campaignId: "c1", cpl: 50, costPerBooked: 200, bookedValueCents: 90000, trueRoas: 1.5 },
          {
            campaignId: "c2",
            cpl: null,
            costPerBooked: null,
            bookedValueCents: null,
            trueRoas: null,
          },
        ],
      },
    });
    expect(r.campaignEconomics?.rows).toHaveLength(2);
    expect(r.campaignEconomics?.rows[1]?.trueRoas).toBeNull();
  });
});
