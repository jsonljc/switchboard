import { describe, it, expect } from "vitest";
import { ProviderPerformanceTracker } from "../ugc/provider-performance.js";

describe("ProviderPerformanceTracker", () => {
  it("starts with empty history", () => {
    const tracker = new ProviderPerformanceTracker();
    const history = tracker.getHistory();
    expect(history.passRateByProvider).toEqual({});
    expect(history.avgLatencyByProvider).toEqual({});
    expect(history.costByProvider).toEqual({});
  });

  it("records a successful attempt", () => {
    const tracker = new ProviderPerformanceTracker();
    tracker.record({ provider: "kling", passed: true, latencyMs: 5000, cost: 0.5 });
    const history = tracker.getHistory();
    expect(history.passRateByProvider["kling"]).toBe(1.0);
    expect(history.avgLatencyByProvider["kling"]).toBe(5000);
    expect(history.costByProvider["kling"]).toBe(0.5);
  });

  it("records mixed results and computes averages", () => {
    const tracker = new ProviderPerformanceTracker();
    tracker.record({ provider: "kling", passed: true, latencyMs: 4000, cost: 0.5 });
    tracker.record({ provider: "kling", passed: false, latencyMs: 6000, cost: 0.5 });
    tracker.record({ provider: "kling", passed: true, latencyMs: 5000, cost: 0.5 });
    const history = tracker.getHistory();
    expect(history.passRateByProvider["kling"]).toBeCloseTo(0.667, 2);
    expect(history.avgLatencyByProvider["kling"]).toBe(5000);
    expect(history.costByProvider["kling"]).toBe(0.5);
  });

  it("tracks multiple providers independently", () => {
    const tracker = new ProviderPerformanceTracker();
    tracker.record({ provider: "kling", passed: true, latencyMs: 4000, cost: 0.5 });
    tracker.record({ provider: "heygen", passed: false, latencyMs: 8000, cost: 1.0 });
    const history = tracker.getHistory();
    expect(history.passRateByProvider["kling"]).toBe(1.0);
    expect(history.passRateByProvider["heygen"]).toBe(0.0);
    expect(history.avgLatencyByProvider["kling"]).toBe(4000);
    expect(history.avgLatencyByProvider["heygen"]).toBe(8000);
  });

  it("can be initialized from existing history", () => {
    const tracker = ProviderPerformanceTracker.fromHistory({
      passRateByProvider: { kling: 0.8 },
      avgLatencyByProvider: { kling: 5000 },
      costByProvider: { kling: 0.5 },
    });
    const history = tracker.getHistory();
    expect(history.passRateByProvider["kling"]).toBe(0.8);
  });
});
