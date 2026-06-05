import { describe, it, expect } from "vitest";
import {
  RecommendationOutputSchema,
  EconomicTierSchema,
  MarginBasisSchema,
  TargetSourceSchema,
  AuditReportSchema,
  OwnershipClassSchema,
  EmittableOwnershipClassSchema,
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
    expect(TargetSourceSchema.options).toEqual(["campaign", "account"]);
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

describe("AuditReportSchema ownership (Riley v3, spec 2.2 net-new item 1)", () => {
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

  it("parses without ownership (back-compat: pre-ownership reports)", () => {
    expect(AuditReportSchema.parse(baseReport).ownership).toBeUndefined();
  });

  it("parses ownership entries for every emittable class", () => {
    const r = AuditReportSchema.parse({
      ...baseReport,
      ownership: [
        { campaignId: "c1", action: "hold", index: 0, ownership: "operator_swipe" },
        { campaignId: "c1", action: "pause", index: 1, ownership: "human_escalation" },
        { campaignId: "c2", action: "refresh_creative", index: 2, ownership: "mira_handoff" },
        {
          campaignId: "account",
          action: "shift_budget_to_source",
          index: 3,
          ownership: "operator_approval",
        },
      ],
    });
    expect(r.ownership).toHaveLength(4);
    expect(r.ownership?.[2]?.ownership).toBe("mira_handoff");
  });

  it("REJECTS riley_self on today's report wire (Phase-C widens this deliberately)", () => {
    expect(() =>
      AuditReportSchema.parse({
        ...baseReport,
        ownership: [{ campaignId: "c1", action: "pause", index: 0, ownership: "riley_self" }],
      }),
    ).toThrow();
  });

  it("rejects an unknown ownership class and a negative index", () => {
    expect(() =>
      AuditReportSchema.parse({
        ...baseReport,
        ownership: [{ campaignId: "c1", action: "pause", index: 0, ownership: "operator" }],
      }),
    ).toThrow();
    expect(() =>
      AuditReportSchema.parse({
        ...baseReport,
        ownership: [{ campaignId: "c1", action: "pause", index: -1, ownership: "operator_swipe" }],
      }),
    ).toThrow();
  });

  it("pins the two enums against drift: reserved = emittable + riley_self", () => {
    expect(OwnershipClassSchema.options).toEqual([
      ...EmittableOwnershipClassSchema.options,
      "riley_self",
    ]);
    expect(EmittableOwnershipClassSchema.options).toEqual([
      "operator_swipe",
      "operator_approval",
      "mira_handoff",
      "human_escalation",
    ]);
  });
});
