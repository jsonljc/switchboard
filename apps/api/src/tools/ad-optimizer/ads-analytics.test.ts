import { describe, it, expect } from "vitest";
import { createAdsAnalyticsTool } from "./ads-analytics.js";

describe("ads-analytics tool", () => {
  const tool = createAdsAnalyticsTool();

  it("has correct id", () => {
    expect(tool.id).toBe("ads-analytics");
  });

  it("has 4 operations", () => {
    expect(Object.keys(tool.operations)).toEqual([
      "diagnose",
      "compare-periods",
      "analyze-funnel",
      "check-learning-phase",
    ]);
  });

  it("all operations have effectCategory read", () => {
    for (const op of Object.values(tool.operations)) {
      expect(op.effectCategory).toBe("read");
    }
  });

  describe("diagnose", () => {
    it("detects creative fatigue pattern", async () => {
      const deltas = [
        {
          metric: "ctr",
          current: 1.2,
          previous: 2.0,
          deltaPercent: -40,
          direction: "down",
          significant: true,
        },
        {
          metric: "frequency",
          current: 4.0,
          previous: 3.0,
          deltaPercent: 33,
          direction: "up",
          significant: true,
        },
        {
          metric: "cpm",
          current: 10,
          previous: 9.5,
          deltaPercent: 5,
          direction: "up",
          significant: false,
        },
      ];
      const result = (await tool.operations["diagnose"]!.execute({ deltas })) as {
        diagnoses: unknown[];
      };
      expect(result.diagnoses).toContainEqual(
        expect.objectContaining({ pattern: "creative_fatigue" }),
      );
    });

    it("returns empty for healthy metrics", async () => {
      const deltas = [
        {
          metric: "ctr",
          current: 2.0,
          previous: 2.0,
          deltaPercent: 0,
          direction: "stable",
          significant: false,
        },
        {
          metric: "cpa",
          current: 50,
          previous: 55,
          deltaPercent: -9,
          direction: "down",
          significant: false,
        },
      ];
      const result = (await tool.operations["diagnose"]!.execute({ deltas })) as {
        diagnoses: unknown[];
      };
      expect(result.diagnoses).toHaveLength(0);
    });
  });

  describe("compare-periods", () => {
    it("computes deltas for all 7 metrics", async () => {
      const current = { cpm: 10, ctr: 2, cpc: 5, cpl: 50, cpa: 100, roas: 3, frequency: 2 };
      const previous = { cpm: 8, ctr: 2.5, cpc: 4, cpl: 40, cpa: 80, roas: 3.5, frequency: 1.5 };
      const result = (await tool.operations["compare-periods"]!.execute({
        current,
        previous,
      })) as { deltas: unknown[] };
      expect(result.deltas).toHaveLength(7);
    });
  });

  describe("analyze-funnel", () => {
    it("identifies leakage point", async () => {
      const result = (await tool.operations["analyze-funnel"]!.execute({
        insights: [
          {
            campaignId: "c1",
            campaignName: "C1",
            status: "ACTIVE",
            impressions: 10000,
            clicks: 200,
            spend: 500,
            conversions: 5,
            revenue: 1000,
            frequency: 2,
          },
        ],
        crmData: { leads: 5, qualified: 1, closed: 0, revenue: 0 },
        benchmarks: {
          ctr: 2,
          landingPageViewRate: 0.8,
          leadRate: 0.05,
          qualificationRate: 0.3,
          closeRate: 0.2,
        },
      })) as { leakagePoint: string };
      expect(result.leakagePoint).toBeDefined();
    });
  });

  describe("check-learning-phase", () => {
    it("detects campaign in learning", async () => {
      const result = (await tool.operations["check-learning-phase"]!.execute({
        campaignId: "c1",
        input: {
          effectiveStatus: "ACTIVE",
          learningPhase: true,
          lastModifiedDays: 2,
          optimizationEvents: 10,
        },
      })) as { inLearning: boolean };
      expect(result.inLearning).toBe(true);
    });

    it("detects campaign not in learning", async () => {
      const result = (await tool.operations["check-learning-phase"]!.execute({
        campaignId: "c1",
        input: {
          effectiveStatus: "ACTIVE",
          learningPhase: false,
          lastModifiedDays: 14,
          optimizationEvents: 100,
        },
      })) as { inLearning: boolean };
      expect(result.inLearning).toBe(false);
    });
  });
});
