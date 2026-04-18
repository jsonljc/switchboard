// packages/core/src/ad-optimizer/__tests__/period-comparator.test.ts
import { describe, it, expect } from "vitest";
import { comparePeriods } from "../period-comparator.js";
import type { MetricSet } from "../period-comparator.js";

const BASE: MetricSet = {
  cpm: 10,
  ctr: 2.5,
  cpc: 0.5,
  cpl: 5,
  cpa: 20,
  roas: 3,
  frequency: 1.5,
};

describe("comparePeriods", () => {
  it("computes deltas correctly — CPM up ~11%", () => {
    const current: MetricSet = { ...BASE, cpm: 11.1 };
    const previous: MetricSet = { ...BASE };

    const deltas = comparePeriods(current, previous);

    const cpmDelta = deltas.find((d) => d.metric === "cpm");
    expect(cpmDelta).toBeDefined();
    expect(cpmDelta!.current).toBe(11.1);
    expect(cpmDelta!.previous).toBe(10);
    expect(cpmDelta!.deltaPercent).toBeCloseTo(11, 0);
    expect(cpmDelta!.direction).toBe("up");
    // 11% is not > 15%, so not significant
    expect(cpmDelta!.significant).toBe(false);
  });

  it("flags deltas > 15% as significant — CPM 25% up, CTR 40% down", () => {
    const current: MetricSet = { ...BASE, cpm: 12.5, ctr: 1.5 };
    const previous: MetricSet = { ...BASE };

    const deltas = comparePeriods(current, previous);

    const cpmDelta = deltas.find((d) => d.metric === "cpm");
    expect(cpmDelta!.deltaPercent).toBeCloseTo(25, 0);
    expect(cpmDelta!.direction).toBe("up");
    expect(cpmDelta!.significant).toBe(true);

    const ctrDelta = deltas.find((d) => d.metric === "ctr");
    expect(ctrDelta!.deltaPercent).toBeCloseTo(-40, 0);
    expect(ctrDelta!.direction).toBe("down");
    expect(ctrDelta!.significant).toBe(true);
  });

  it("marks near-zero change as stable and not significant", () => {
    const deltas = comparePeriods(BASE, BASE);

    for (const delta of deltas) {
      expect(delta.deltaPercent).toBe(0);
      expect(delta.direction).toBe("stable");
      expect(delta.significant).toBe(false);
    }
  });

  it("handles zero previous values without division error", () => {
    const previous: MetricSet = { cpm: 0, ctr: 0, cpc: 0, cpl: 0, cpa: 0, roas: 0, frequency: 0 };
    const current: MetricSet = { cpm: 10, ctr: 0, cpc: 5, cpl: 3, cpa: 20, roas: 2, frequency: 0 };

    const deltas = comparePeriods(current, previous);

    // Non-zero current → deltaPercent=100, direction="up", significant=true
    const cpmDelta = deltas.find((d) => d.metric === "cpm");
    expect(cpmDelta!.deltaPercent).toBe(100);
    expect(cpmDelta!.direction).toBe("up");
    expect(cpmDelta!.significant).toBe(true);

    // Both zero → deltaPercent=0, direction="stable", significant=false
    const ctrDelta = deltas.find((d) => d.metric === "ctr");
    expect(ctrDelta!.deltaPercent).toBe(0);
    expect(ctrDelta!.direction).toBe("stable");
    expect(ctrDelta!.significant).toBe(false);

    const freqDelta = deltas.find((d) => d.metric === "frequency");
    expect(freqDelta!.deltaPercent).toBe(0);
    expect(freqDelta!.direction).toBe("stable");
    expect(freqDelta!.significant).toBe(false);
  });

  it("returns a delta for every metric in MetricSet", () => {
    const deltas = comparePeriods(BASE, BASE);
    const keys: (keyof MetricSet)[] = ["cpm", "ctr", "cpc", "cpl", "cpa", "roas", "frequency"];
    for (const key of keys) {
      expect(deltas.find((d) => d.metric === key)).toBeDefined();
    }
  });
});
