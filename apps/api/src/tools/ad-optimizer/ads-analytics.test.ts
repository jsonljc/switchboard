import { describe, it, expect } from "vitest";
import { createAdsAnalyticsTool } from "./ads-analytics.js";

describe("ads-analytics tool", () => {
  const tool = createAdsAnalyticsTool();

  it("has correct id", () => {
    expect(tool.id).toBe("ads-analytics");
  });

  it("has 6 operations", () => {
    expect(Object.keys(tool.operations)).toEqual([
      "diagnose",
      "compare-periods",
      "analyze-funnel",
      "check-learning-phase",
      "detect-saturation",
      "analyze-creatives",
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
      const result = await tool.operations["diagnose"]!.execute({ deltas });
      expect(result.status).toBe("success");
      expect(result.data?.diagnoses as unknown[]).toContainEqual(
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
      const result = await tool.operations["diagnose"]!.execute({ deltas });
      expect(result.status).toBe("success");
      expect(result.data?.diagnoses as unknown[]).toHaveLength(0);
    });
  });

  describe("compare-periods", () => {
    it("computes deltas for all 7 metrics", async () => {
      const current = { cpm: 10, ctr: 2, cpc: 5, cpl: 50, cpa: 100, roas: 3, frequency: 2 };
      const previous = { cpm: 8, ctr: 2.5, cpc: 4, cpl: 40, cpa: 80, roas: 3.5, frequency: 1.5 };
      const result = await tool.operations["compare-periods"]!.execute({
        current,
        previous,
      });
      expect(result.status).toBe("success");
      expect(result.data?.deltas as unknown[]).toHaveLength(7);
    });
  });

  describe("analyze-funnel", () => {
    it("identifies leakage point", async () => {
      const result = await tool.operations["analyze-funnel"]!.execute({
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
        crmData: {
          campaignIds: ["c1"],
          leads: 5,
          qualified: 1,
          opportunities: 0,
          bookings: 0,
          closed: 0,
          revenue: 0,
          rates: {
            leadToQualified: 0.2,
            qualifiedToBooking: null,
            bookingToClosed: null,
            leadToClosed: 0,
          },
          coverage: {
            attributedContacts: 5,
            contactsWithEmailOrPhone: 5,
            contactsWithOpportunity: 0,
            contactsWithBooking: 0,
            contactsWithRevenueEvent: 0,
          },
        },
        crmBenchmarks: {
          leadToQualifiedRate: 0.3,
          qualifiedToBookingRate: 0.5,
          bookingToClosedRate: 0.2,
          leadToClosedRate: 0.03,
        },
        mediaBenchmarks: {
          ctr: 2,
          landingPageViewRate: 0.8,
          clickToLeadRate: 0.05,
        },
      });
      expect(result.status).toBe("success");
      expect(result.data?.leakagePoint).toBeDefined();
    });
  });

  describe("check-learning-phase", () => {
    it("detects campaign in learning", async () => {
      const result = await tool.operations["check-learning-phase"]!.execute({
        campaignId: "c1",
        input: {
          effectiveStatus: "ACTIVE",
          learningPhase: true,
          lastModifiedDays: 2,
          optimizationEvents: 10,
        },
      });
      expect(result.status).toBe("success");
      expect(result.data?.inLearning).toBe(true);
    });

    it("detects campaign not in learning", async () => {
      const result = await tool.operations["check-learning-phase"]!.execute({
        campaignId: "c1",
        input: {
          effectiveStatus: "ACTIVE",
          learningPhase: false,
          lastModifiedDays: 14,
          optimizationEvents: 100,
        },
      });
      expect(result.status).toBe("success");
      expect(result.data?.inLearning).toBe(false);
    });
  });

  describe("detect-saturation", () => {
    it("returns audience saturation signal when frequency rising and ctr falling", async () => {
      const result = await tool.operations["detect-saturation"]!.execute({
        adSetId: "as1",
        trends: [
          {
            metric: "frequency",
            direction: "rising",
            consecutiveWeeks: 3,
            latestValue: 4.0,
            deltaPercent: 15,
          },
          {
            metric: "ctr",
            direction: "falling",
            consecutiveWeeks: 2,
            latestValue: 1.2,
            deltaPercent: -20,
          },
        ],
        audienceReachedRatio: 0.85,
      });
      expect(result.status).toBe("success");
      const signals = result.data?.signals as unknown[];
      expect(signals.length).toBeGreaterThan(0);
      expect(signals).toContainEqual(expect.objectContaining({ pattern: "audience_saturation" }));
    });

    it("returns empty signals for healthy trends", async () => {
      const result = await tool.operations["detect-saturation"]!.execute({
        adSetId: "as2",
        trends: [
          {
            metric: "frequency",
            direction: "stable",
            consecutiveWeeks: 0,
            latestValue: 1.5,
            deltaPercent: 0,
          },
          {
            metric: "ctr",
            direction: "stable",
            consecutiveWeeks: 0,
            latestValue: 2.5,
            deltaPercent: 0,
          },
        ],
      });
      expect(result.status).toBe("success");
      expect(result.data?.signals as unknown[]).toHaveLength(0);
    });
  });

  describe("analyze-creatives", () => {
    it("returns analysis with entries and diagnoses", async () => {
      const result = await tool.operations["analyze-creatives"]!.execute({
        campaignId: "c1",
        creativeEntries: [
          {
            creativeKey: "img_001",
            keyType: "image_hash",
            adIds: ["a1"],
            spend: 800,
            spendShare: 0.8,
            impressions: 10000,
            clicks: 200,
            ctr: 2.0,
            cpc: 4.0,
            cpa: 50,
            roas: 3.0,
            conversions: 16,
            thumbStopRatio: null,
            qualityRanking: "ABOVE_AVERAGE_35",
            engagementRateRanking: "AVERAGE",
            conversionRateRanking: "AVERAGE",
          },
          {
            creativeKey: "img_002",
            keyType: "image_hash",
            adIds: ["a2"],
            spend: 200,
            spendShare: 0.2,
            impressions: 5000,
            clicks: 50,
            ctr: 1.0,
            cpc: 4.0,
            cpa: 200,
            roas: 1.0,
            conversions: 1,
            thumbStopRatio: null,
            qualityRanking: "BELOW_AVERAGE_10",
            engagementRateRanking: "BELOW_AVERAGE_20",
            conversionRateRanking: "BELOW_AVERAGE_10",
          },
        ],
      });
      expect(result.status).toBe("success");
      expect(result.data?.campaignId).toBe("c1");
      expect(result.data?.entries as unknown[]).toHaveLength(2);
      const diagnoses = result.data?.diagnoses as unknown[];
      expect(diagnoses.length).toBeGreaterThan(0);
      expect(diagnoses).toContainEqual(expect.objectContaining({ pattern: "spend_concentration" }));
    });

    it("returns empty diagnoses for balanced creatives", async () => {
      const result = await tool.operations["analyze-creatives"]!.execute({
        campaignId: "c2",
        creativeEntries: [
          {
            creativeKey: "img_003",
            keyType: "image_hash",
            adIds: ["a3"],
            spend: 500,
            spendShare: 0.5,
            impressions: 5000,
            clicks: 100,
            ctr: 2.0,
            cpc: 5.0,
            cpa: 50,
            roas: 3.0,
            conversions: 10,
            thumbStopRatio: null,
            qualityRanking: null,
            engagementRateRanking: null,
            conversionRateRanking: null,
          },
          {
            creativeKey: "img_004",
            keyType: "image_hash",
            adIds: ["a4"],
            spend: 500,
            spendShare: 0.5,
            impressions: 5000,
            clicks: 100,
            ctr: 2.0,
            cpc: 5.0,
            cpa: 50,
            roas: 3.0,
            conversions: 10,
            thumbStopRatio: null,
            qualityRanking: null,
            engagementRateRanking: null,
            conversionRateRanking: null,
          },
        ],
      });
      expect(result.status).toBe("success");
      expect(result.data?.diagnoses as unknown[]).toHaveLength(0);
    });
  });
});
