// packages/core/src/ad-optimizer/__tests__/metric-diagnostician.test.ts
import { describe, it, expect } from "vitest";
import { diagnose } from "../metric-diagnostician.js";
import type { MetricDeltaSchema as MetricDelta } from "@switchboard/schemas";

function makeDelta(
  metric: string,
  current: number,
  previous: number,
  direction: "up" | "down" | "stable",
  significant: boolean,
): MetricDelta {
  const deltaPercent = previous === 0 ? 0 : ((current - previous) / previous) * 100;
  return { metric, current, previous, deltaPercent, direction, significant };
}

describe("diagnose", () => {
  it("detects creative_fatigue: CPM stable + CTR down significant + frequency=4.0", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 10, 10, "stable", false),
      makeDelta("ctr", 1.0, 2.0, "down", true),
      makeDelta("frequency", 4.0, 2.0, "up", true),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("creative_fatigue");
    const fatigue = result.find((d) => d.pattern === "creative_fatigue")!;
    expect(fatigue.confidence).toBe("high");
  });

  it("detects landing_page_drop: CTR stable + CPL up significant", () => {
    const deltas: MetricDelta[] = [
      makeDelta("ctr", 2.5, 2.5, "stable", false),
      makeDelta("cpl", 15, 10, "up", true),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("landing_page_drop");
    const landing = result.find((d) => d.pattern === "landing_page_drop")!;
    expect(landing.confidence).toBe("high");
  });

  it("detects audience_saturation: frequency=4.0 + CTR down significant", () => {
    const deltas: MetricDelta[] = [
      makeDelta("frequency", 4.0, 2.0, "up", true),
      makeDelta("ctr", 1.0, 2.5, "down", true),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("audience_saturation");
    const saturation = result.find((d) => d.pattern === "audience_saturation")!;
    expect(saturation.confidence).toBe("high");
  });

  it("returns empty array when no patterns match (all stable)", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 10, 10, "stable", false),
      makeDelta("ctr", 2.5, 2.5, "stable", false),
      makeDelta("cpl", 5, 5, "stable", false),
      makeDelta("cpa", 20, 20, "stable", false),
      makeDelta("frequency", 1.5, 1.5, "stable", false),
    ];

    const result = diagnose(deltas);

    expect(result).toEqual([]);
  });

  it("detects competition_increase: CPM up significant + CTR stable", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 12, 10, "up", true),
      makeDelta("ctr", 2.5, 2.5, "stable", false),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("competition_increase");
    const competition = result.find((d) => d.pattern === "competition_increase")!;
    expect(competition.confidence).toBe("medium");
  });

  it("detects lead_quality_issue: CPA up significant + CPL not significant", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpa", 30, 20, "up", true),
      makeDelta("cpl", 5.5, 5, "up", false),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("lead_quality_issue");
    const quality = result.find((d) => d.pattern === "lead_quality_issue")!;
    expect(quality.confidence).toBe("medium");
  });

  it("detects audience_offer_mismatch: CTR up + CPA up significant", () => {
    const deltas: MetricDelta[] = [
      makeDelta("ctr", 3.0, 2.5, "up", true),
      makeDelta("cpa", 30, 20, "up", true),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("audience_offer_mismatch");
    const mismatch = result.find((d) => d.pattern === "audience_offer_mismatch")!;
    expect(mismatch.confidence).toBe("high");
  });

  it("detects account_level_issue when 3+ metrics are significantly degrading", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 12, 10, "up", true), // cost up = degrading
      makeDelta("cpc", 1.5, 1.0, "up", true), // cost up = degrading
      makeDelta("cpl", 15, 10, "up", true), // cost up = degrading
      makeDelta("ctr", 2.5, 2.5, "stable", false),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("account_level_issue");
    const account = result.find((d) => d.pattern === "account_level_issue")!;
    expect(account.confidence).toBe("low");
  });

  it("does not detect account_level_issue when only 2 metrics degrade", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 12, 10, "up", true), // cost up = degrading
      makeDelta("cpc", 1.5, 1.0, "up", true), // cost up = degrading
      makeDelta("ctr", 2.5, 2.5, "stable", false),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).not.toContain("account_level_issue");
  });
});
