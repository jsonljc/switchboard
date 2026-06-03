import { describe, it, expect } from "vitest";
import { analyzeV2Sections } from "./audit-v2-sections.js";
import { LearningPhaseGuardV2 } from "./learning-phase-guard.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  AdSetLearningInput,
  MetricSnapshotSchema as MetricSnapshot,
} from "@switchboard/schemas";

function makeInsight(overrides: Partial<CampaignInsight> = {}): CampaignInsight {
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

function makeAdSet(overrides: Partial<AdSetLearningInput> = {}): AdSetLearningInput {
  return {
    adSetId: "adset-1",
    adSetName: "Ad Set 1",
    campaignId: "camp-1",
    learningStageStatus: "SUCCESS",
    frequency: 1.5,
    spend: 5_000,
    conversions: 50,
    cpa: 100,
    roas: 3.0,
    inlineLinkClickCtr: 2.0,
    ...overrides,
  };
}

function snapshot(roas: number): MetricSnapshot {
  return {
    cpm: 50,
    inlineLinkClickCtr: 2.0,
    costPerInlineLinkClick: 2.5,
    cpl: 100,
    cpa: 100,
    roas,
  };
}

const guard = new LearningPhaseGuardV2();

describe("analyzeV2Sections", () => {
  it("returns empty/zero with no ad-set, trend, or budget inputs", () => {
    const out = analyzeV2Sections({
      adSetData: null,
      trendRawData: null,
      currentInsights: [makeInsight()],
      learningGuardV2: guard,
      targetCPA: 100,
    });
    expect(out.adSetDetails).toBeUndefined();
    expect(out.adSetsInLearning).toBe(0);
    expect(out.adSetsLearningLimited).toBe(0);
    expect(out.learningLimitedRecs).toEqual([]);
    expect(out.trends).toBeUndefined();
    expect(out.budgetDistribution).toBeUndefined(); // only one insight
  });

  it("counts learning + learning_limited ad sets and emits a learning-limited rec", () => {
    const out = analyzeV2Sections({
      adSetData: [
        makeAdSet({ adSetId: "as-learning", learningStageStatus: "LEARNING" }),
        // FAIL → learning_limited; freq 2 (≤3) + spend 5000 (≥100) → review_budget
        makeAdSet({
          adSetId: "as-limited",
          learningStageStatus: "FAIL",
          frequency: 2,
          spend: 5_000,
        }),
      ],
      trendRawData: null,
      currentInsights: [makeInsight()],
      learningGuardV2: guard,
      targetCPA: 100,
    });
    expect(out.adSetDetails).toHaveLength(2);
    expect(out.adSetsInLearning).toBe(1);
    expect(out.adSetsLearningLimited).toBe(1);
    expect(out.learningLimitedRecs).toHaveLength(1);
    expect(out.learningLimitedRecs[0]?.action).toBe("review_budget");
    expect(out.learningLimitedRecs[0]?.campaignId).toBe("camp-1");
  });

  it("builds trends when trend data is present", () => {
    const trendRawData = {
      day30: snapshot(3.0),
      day60: snapshot(3.1),
      day90: snapshot(3.2),
      weekly: [snapshot(3.1), snapshot(3.0), snapshot(2.9)],
    };
    const out = analyzeV2Sections({
      adSetData: null,
      trendRawData,
      currentInsights: [makeInsight()],
      learningGuardV2: guard,
      targetCPA: 100,
    });
    expect(out.trends).toBeDefined();
    expect(out.trends?.rollingAverages.day30).toEqual(trendRawData.day30);
    expect(out.trends?.weeklySnapshots).toHaveLength(3);
  });

  it("builds budget distribution only when at least two campaigns are present", () => {
    const twoCampaigns = analyzeV2Sections({
      adSetData: null,
      trendRawData: null,
      currentInsights: [
        makeInsight({ campaignId: "c1", spend: 600 }),
        makeInsight({ campaignId: "c2", spend: 400 }),
      ],
      learningGuardV2: guard,
      targetCPA: 100,
    });
    expect(twoCampaigns.budgetDistribution).toBeDefined();

    const oneCampaign = analyzeV2Sections({
      adSetData: null,
      trendRawData: null,
      currentInsights: [makeInsight({ campaignId: "c1" })],
      learningGuardV2: guard,
      targetCPA: 100,
    });
    expect(oneCampaign.budgetDistribution).toBeUndefined();
  });
});
