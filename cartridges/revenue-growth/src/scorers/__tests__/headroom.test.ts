// ---------------------------------------------------------------------------
// Headroom Scorer — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { scoreHeadroom } from "../headroom.js";
import type { NormalizedData } from "@switchboard/schemas";

function makeData(overrides: Partial<NormalizedData> = {}): NormalizedData {
  return {
    accountId: "acc_1",
    organizationId: "org_1",
    collectedAt: new Date().toISOString(),
    dataTier: "PARTIAL",
    adMetrics: null,
    funnelEvents: [],
    creativeAssets: null,
    crmSummary: null,
    signalHealth: null,
    headroom: null,
    ...overrides,
  };
}

describe("scoreHeadroom", () => {
  it("returns score 0 with NO_HEADROOM_DATA issue when no headroom", () => {
    const result = scoreHeadroom(makeData());

    expect(result.scorerName).toBe("headroom");
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("LOW");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.code).toBe("NO_HEADROOM_DATA");
  });

  it("scores highly with good headroom", () => {
    const data = makeData({
      headroom: {
        headroomPercent: 60,
        currentDailySpend: 5000,
        recommendedDailySpend: 8000,
        rSquared: 0.9,
        confidence: "HIGH",
        caveats: [],
      },
    });

    const result = scoreHeadroom(data);

    expect(result.score).toBeGreaterThan(50);
    expect(result.confidence).toBe("HIGH");
    expect(result.issues.filter((i) => i.severity === "critical")).toHaveLength(0);
  });

  it("detects saturation (< 5% headroom)", () => {
    const data = makeData({
      headroom: {
        headroomPercent: 3,
        currentDailySpend: 9700,
        recommendedDailySpend: 10000,
        rSquared: 0.85,
        confidence: "HIGH",
        caveats: [],
      },
    });

    const result = scoreHeadroom(data);

    expect(result.score).toBeLessThan(45);
    expect(result.issues.some((i) => i.code === "HEADROOM_SATURATED")).toBe(true);
  });

  it("warns about low headroom (5-15%)", () => {
    const data = makeData({
      headroom: {
        headroomPercent: 10,
        currentDailySpend: 9000,
        recommendedDailySpend: 9900,
        rSquared: 0.8,
        confidence: "MEDIUM",
        caveats: [],
      },
    });

    const result = scoreHeadroom(data);

    expect(result.issues.some((i) => i.code === "HEADROOM_LOW")).toBe(true);
  });

  it("warns about low model confidence (R² < 0.5)", () => {
    const data = makeData({
      headroom: {
        headroomPercent: 50,
        currentDailySpend: 5000,
        recommendedDailySpend: 7500,
        rSquared: 0.3,
        confidence: "LOW",
        caveats: [],
      },
    });

    const result = scoreHeadroom(data);

    expect(result.issues.some((i) => i.code === "HEADROOM_LOW_CONFIDENCE")).toBe(true);
  });

  it("warns about many caveats", () => {
    const data = makeData({
      headroom: {
        headroomPercent: 40,
        currentDailySpend: 5000,
        recommendedDailySpend: 7000,
        rSquared: 0.75,
        confidence: "MEDIUM",
        caveats: [
          "Limited data points",
          "Seasonality detected",
          "Recent campaign change",
          "Platform change",
        ],
      },
    });

    const result = scoreHeadroom(data);

    expect(result.issues.some((i) => i.code === "HEADROOM_MANY_CAVEATS")).toBe(true);
  });

  it("populates breakdown with all sub-scores", () => {
    const data = makeData({
      headroom: {
        headroomPercent: 50,
        currentDailySpend: 5000,
        recommendedDailySpend: 7500,
        rSquared: 0.8,
        confidence: "MEDIUM",
        caveats: ["Limited data"],
      },
    });

    const result = scoreHeadroom(data);

    expect(result.breakdown).toHaveProperty("headroomPercent");
    expect(result.breakdown).toHaveProperty("modelConfidence");
    expect(result.breakdown).toHaveProperty("caveats");
  });

  it("clamps score between 0 and 100", () => {
    const data = makeData({
      headroom: {
        headroomPercent: 200, // extreme value
        currentDailySpend: 1000,
        recommendedDailySpend: 3000,
        rSquared: 0.99,
        confidence: "HIGH",
        caveats: [],
      },
    });

    const result = scoreHeadroom(data);

    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("maps confidence from headroom model", () => {
    const highConf = scoreHeadroom(
      makeData({
        headroom: {
          headroomPercent: 50,
          currentDailySpend: 5000,
          recommendedDailySpend: 7500,
          rSquared: 0.9,
          confidence: "HIGH",
          caveats: [],
        },
      }),
    );
    expect(highConf.confidence).toBe("HIGH");

    const lowConf = scoreHeadroom(
      makeData({
        headroom: {
          headroomPercent: 50,
          currentDailySpend: 5000,
          recommendedDailySpend: 7500,
          rSquared: 0.9,
          confidence: "LOW",
          caveats: [],
        },
      }),
    );
    expect(lowConf.confidence).toBe("LOW");
  });
});
