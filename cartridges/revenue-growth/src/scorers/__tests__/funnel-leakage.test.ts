// ---------------------------------------------------------------------------
// Funnel Leakage Scorer — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { scoreFunnelLeakage } from "../funnel-leakage.js";
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

describe("scoreFunnelLeakage", () => {
  it("returns score 0 with NO_FUNNEL_DATA issue when no events", () => {
    const result = scoreFunnelLeakage(makeData());

    expect(result.scorerName).toBe("funnel-leakage");
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("LOW");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.code).toBe("NO_FUNNEL_DATA");
  });

  it("flags insufficient stages when fewer than 3", () => {
    const data = makeData({
      funnelEvents: [
        { stageName: "Impression", count: 1000, previousCount: null },
        { stageName: "Click", count: 200, previousCount: null },
      ],
    });

    const result = scoreFunnelLeakage(data);

    expect(result.score).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.code === "INSUFFICIENT_FUNNEL_STAGES")).toBe(true);
  });

  it("scores a healthy funnel highly", () => {
    const data = makeData({
      dataTier: "FULL",
      funnelEvents: [
        { stageName: "Impression", count: 10000, previousCount: 9500 },
        { stageName: "Click", count: 5000, previousCount: 4800 },
        { stageName: "Lead", count: 2500, previousCount: 2400 },
        { stageName: "Sale", count: 1250, previousCount: 1200 },
      ],
    });

    const result = scoreFunnelLeakage(data);

    expect(result.score).toBeGreaterThan(60);
    expect(result.confidence).toBe("HIGH");
    expect(result.issues.filter((i) => i.severity === "critical")).toHaveLength(0);
  });

  it("detects critical drop-off (>70%)", () => {
    const data = makeData({
      funnelEvents: [
        { stageName: "Impression", count: 10000, previousCount: null },
        { stageName: "Click", count: 2000, previousCount: null },
        { stageName: "Lead", count: 100, previousCount: null }, // 95% drop-off from Click
        { stageName: "Sale", count: 50, previousCount: null },
      ],
    });

    const result = scoreFunnelLeakage(data);

    expect(result.score).toBeLessThan(50);
    expect(result.issues.some((i) => i.code === "FUNNEL_STAGE_CRITICAL_DROPOFF")).toBe(true);
  });

  it("detects high drop-off (50-70%)", () => {
    const data = makeData({
      funnelEvents: [
        { stageName: "Impression", count: 10000, previousCount: null },
        { stageName: "Click", count: 4000, previousCount: null }, // 60% drop-off
        { stageName: "Lead", count: 2000, previousCount: null }, // 50% drop-off
        { stageName: "Sale", count: 1000, previousCount: null },
      ],
    });

    const result = scoreFunnelLeakage(data);

    expect(result.issues.some((i) => i.code === "FUNNEL_STAGE_HIGH_DROPOFF")).toBe(true);
  });

  it("detects low overall conversion", () => {
    const data = makeData({
      funnelEvents: [
        { stageName: "Impression", count: 100000, previousCount: null },
        { stageName: "Click", count: 5000, previousCount: null },
        { stageName: "Lead", count: 500, previousCount: null },
        { stageName: "Sale", count: 5, previousCount: null }, // 0.005% overall
      ],
    });

    const result = scoreFunnelLeakage(data);

    expect(result.issues.some((i) => i.code === "FUNNEL_LOW_OVERALL_CONVERSION")).toBe(true);
  });

  it("detects WoW declining stages", () => {
    const data = makeData({
      funnelEvents: [
        { stageName: "Impression", count: 10000, previousCount: 10000 },
        { stageName: "Click", count: 2000, previousCount: 4000 }, // -50% WoW
        { stageName: "Lead", count: 500, previousCount: 500 },
        { stageName: "Sale", count: 100, previousCount: 100 },
      ],
    });

    const result = scoreFunnelLeakage(data);

    expect(result.issues.some((i) => i.code === "FUNNEL_STAGE_DECLINING")).toBe(true);
  });

  it("populates breakdown with all sub-scores", () => {
    const data = makeData({
      funnelEvents: [
        { stageName: "Impression", count: 10000, previousCount: null },
        { stageName: "Click", count: 5000, previousCount: null },
        { stageName: "Lead", count: 2500, previousCount: null },
        { stageName: "Sale", count: 1250, previousCount: null },
      ],
    });

    const result = scoreFunnelLeakage(data);

    expect(result.breakdown).toHaveProperty("worstDropoff");
    expect(result.breakdown).toHaveProperty("overallConversion");
    expect(result.breakdown).toHaveProperty("consistency");
    expect(result.breakdown).toHaveProperty("completeness");
  });

  it("scores between 0 and 100", () => {
    const data = makeData({
      funnelEvents: [
        { stageName: "A", count: 1000, previousCount: null },
        { stageName: "B", count: 500, previousCount: null },
        { stageName: "C", count: 250, previousCount: null },
      ],
    });

    const result = scoreFunnelLeakage(data);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
