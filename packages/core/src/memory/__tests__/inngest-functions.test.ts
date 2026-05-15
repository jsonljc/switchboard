import { describe, it, expect, vi } from "vitest";
import { executeDailyPatternDecay, type PatternDecayDependencies } from "../inngest-functions.js";

function makeStep() {
  return {
    run: vi.fn(async <T>(_id: string, fn: () => Promise<T>) => fn()),
  };
}

describe("executeDailyPatternDecay", () => {
  it("invokes decayStale with the configured window + floor + start-of-day", async () => {
    const step = makeStep();
    const decayStale = vi.fn().mockResolvedValue(5);
    const deps: PatternDecayDependencies = {
      memoryStore: { decayStale },
      now: () => new Date("2026-05-14T07:00:00Z"),
      windowDays: 180,
      decayAmount: 0.1,
      floor: 0.3,
      metrics: { outcomePatternsDecayed: { inc: vi.fn() } },
    };

    await executeDailyPatternDecay(step as never, deps);

    expect(decayStale).toHaveBeenCalledTimes(1);
    const arg = decayStale.mock.calls[0]![0];
    expect(arg.decayAmount).toBe(0.1);
    expect(arg.floor).toBe(0.3);
    expect(arg.startOfDay).toEqual(new Date("2026-05-14T00:00:00Z"));
    expect(arg.cutoffDate).toEqual(new Date("2025-11-15T07:00:00Z"));
  });

  it("emits outcomePatternsDecayed metric with the count returned by decayStale", async () => {
    const step = makeStep();
    const inc = vi.fn();
    const deps: PatternDecayDependencies = {
      memoryStore: { decayStale: vi.fn().mockResolvedValue(7) },
      now: () => new Date("2026-05-14T07:00:00Z"),
      windowDays: 180,
      decayAmount: 0.1,
      floor: 0.3,
      metrics: { outcomePatternsDecayed: { inc } },
    };

    await executeDailyPatternDecay(step as never, deps);

    expect(inc).toHaveBeenCalledWith({ deploymentTier: "aggregate", canonicalCategory: "all" }, 7);
  });
});
