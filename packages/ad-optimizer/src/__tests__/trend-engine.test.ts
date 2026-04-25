import { describe, it, expect } from "vitest";
import type { MetricSnapshotSchema } from "@switchboard/schemas";
import { classifyTrendTier, detectTrends, projectBreach } from "../trend-engine.js";

describe("classifyTrendTier", () => {
  it("returns stable for 0 consecutive weeks", () => {
    expect(classifyTrendTier(0)).toBe("stable");
  });

  it("returns alert for 1 consecutive week", () => {
    expect(classifyTrendTier(1)).toBe("alert");
  });

  it("returns alert for 2 consecutive weeks", () => {
    expect(classifyTrendTier(2)).toBe("alert");
  });

  it("returns confirmed for 3 consecutive weeks", () => {
    expect(classifyTrendTier(3)).toBe("confirmed");
  });

  it("returns confirmed for 4 consecutive weeks", () => {
    expect(classifyTrendTier(4)).toBe("confirmed");
  });
});

function makeSnapshot(overrides: Partial<MetricSnapshotSchema> = {}): MetricSnapshotSchema {
  return {
    cpm: 10,
    ctr: 2,
    cpc: 1,
    cpl: 5,
    cpa: 20,
    roas: 3,
    ...overrides,
  };
}

describe("detectTrends", () => {
  it("detects rising CPA over 3 weeks as confirmed", () => {
    const snapshots = [
      makeSnapshot({ cpa: 10 }),
      makeSnapshot({ cpa: 15 }),
      makeSnapshot({ cpa: 20 }),
    ];
    const trends = detectTrends(snapshots);
    const cpaTrend = trends.find((t) => t.metric === "cpa");
    expect(cpaTrend).toBeDefined();
    expect(cpaTrend!.direction).toBe("rising");
    expect(cpaTrend!.consecutiveWeeks).toBe(2);
    expect(cpaTrend!.tier).toBe("alert");
  });

  it("detects stable when values oscillate", () => {
    const snapshots = [
      makeSnapshot({ cpa: 10 }),
      makeSnapshot({ cpa: 15 }),
      makeSnapshot({ cpa: 12 }),
      makeSnapshot({ cpa: 18 }),
    ];
    const trends = detectTrends(snapshots);
    const cpaTrend = trends.find((t) => t.metric === "cpa");
    expect(cpaTrend).toBeDefined();
    expect(cpaTrend!.direction).toBe("stable");
    expect(cpaTrend!.consecutiveWeeks).toBe(0);
    expect(cpaTrend!.tier).toBe("stable");
  });

  it("detects falling CTR over 2 weeks as alert", () => {
    const snapshots = [
      makeSnapshot({ ctr: 5 }),
      makeSnapshot({ ctr: 4 }),
      makeSnapshot({ ctr: 3 }),
    ];
    const trends = detectTrends(snapshots);
    const ctrTrend = trends.find((t) => t.metric === "ctr");
    expect(ctrTrend).toBeDefined();
    expect(ctrTrend!.direction).toBe("falling");
    expect(ctrTrend!.consecutiveWeeks).toBe(2);
    expect(ctrTrend!.tier).toBe("alert");
  });

  it("returns all 6 metrics", () => {
    const snapshots = [makeSnapshot(), makeSnapshot()];
    const trends = detectTrends(snapshots);
    expect(trends).toHaveLength(6);
    const metrics = trends.map((t) => t.metric).sort();
    expect(metrics).toEqual(["cpa", "cpc", "cpl", "cpm", "ctr", "roas"]);
  });
});

describe("projectBreach", () => {
  it("projects 3 weeks for CPA rising from 70 toward 100 target", () => {
    // Last two values: 60, 70. Rising by 10/week. Target 100. Distance = 30. 30/10 = 3 weeks.
    const values = [50, 60, 70];
    const result = projectBreach(values, 100, "cost");
    expect(result).toBe(3);
  });

  it("returns null when values are flat", () => {
    const values = [70, 70, 70];
    const result = projectBreach(values, 100, "cost");
    expect(result).toBeNull();
  });

  it("returns null when already above target for cost metric", () => {
    const values = [90, 100, 110];
    const result = projectBreach(values, 100, "cost");
    expect(result).toBeNull();
  });

  it("returns null with fewer than 2 data points", () => {
    const values = [70];
    const result = projectBreach(values, 100, "cost");
    expect(result).toBeNull();
  });

  it("projects breach for performance metric trending down", () => {
    // Last two: 80, 70. Falling by 10/week. Target 50. Distance = 20. 20/10 = 2 weeks.
    const values = [90, 80, 70];
    const result = projectBreach(values, 50, "performance");
    expect(result).toBe(2);
  });

  it("returns null for performance metric trending up (away from breach)", () => {
    const values = [60, 70, 80];
    const result = projectBreach(values, 50, "performance");
    expect(result).toBeNull();
  });
});
