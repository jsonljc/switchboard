import { describe, it, expect } from "vitest";
import type { MetricTrendSchema } from "@switchboard/schemas";
import { detectSaturation } from "../saturation-detector.js";

describe("detectSaturation", () => {
  const makeTrend = (
    metric: string,
    direction: "rising" | "falling" | "stable",
    consecutiveWeeks: number,
  ): MetricTrendSchema => ({
    metric,
    direction,
    consecutiveWeeks,
    tier: consecutiveWeeks >= 3 ? "confirmed" : consecutiveWeeks >= 1 ? "alert" : "stable",
    projectedBreachWeeks: null,
  });

  it("detects audience saturation with frequency rising 3 weeks + CTR falling", () => {
    const trends: MetricTrendSchema[] = [
      makeTrend("frequency", "rising", 3),
      makeTrend("ctr", "falling", 2),
    ];

    const signals = detectSaturation("adset-1", trends, null, null);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      adSetId: "adset-1",
      pattern: "audience_saturation",
      confidence: "high",
      audienceReachedRatio: null,
      conversionRateDecline: null,
    });
    expect(signals[0]!.signals.length).toBeGreaterThan(0);
  });

  it("returns no saturation when frequency is stable", () => {
    const trends: MetricTrendSchema[] = [
      makeTrend("frequency", "stable", 5),
      makeTrend("ctr", "falling", 3),
    ];

    const signals = detectSaturation("adset-2", trends, null, null);

    expect(signals).toEqual([]);
  });

  it("detects campaign decay with declining conversion rates", () => {
    const weeklyConversionRates = [0.05, 0.045, 0.035, 0.028, 0.02];

    const signals = detectSaturation("adset-3", [], null, weeklyConversionRates);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      adSetId: "adset-3",
      pattern: "campaign_decay",
      confidence: "medium",
      audienceReachedRatio: null,
    });
    expect(signals[0]!.conversionRateDecline).toBeCloseTo(0.6, 1);
  });

  it("includes audience reached ratio when provided", () => {
    const trends: MetricTrendSchema[] = [
      makeTrend("frequency", "rising", 2),
      makeTrend("ctr", "falling", 1),
    ];

    const signals = detectSaturation("adset-4", trends, 0.85, null);

    expect(signals).toHaveLength(1);
    expect(signals[0]!.audienceReachedRatio).toBe(0.85);
    expect(signals[0]!.signals).toContain("audience_reached_ratio: 0.85");
  });

  it("returns empty array when no signals detected", () => {
    const trends: MetricTrendSchema[] = [
      makeTrend("frequency", "stable", 1),
      makeTrend("ctr", "rising", 3),
    ];

    const signals = detectSaturation("adset-5", trends, null, null);

    expect(signals).toEqual([]);
  });

  it("returns both signals when audience saturation and campaign decay present", () => {
    const trends: MetricTrendSchema[] = [
      makeTrend("frequency", "rising", 4),
      makeTrend("ctr", "falling", 2),
    ];
    const weeklyConversionRates = [0.1, 0.08, 0.06, 0.05, 0.03];

    const signals = detectSaturation("adset-6", trends, 0.9, weeklyConversionRates);

    expect(signals).toHaveLength(2);
    const patterns = signals.map((s) => s.pattern);
    expect(patterns).toContain("audience_saturation");
    expect(patterns).toContain("campaign_decay");
  });
});
