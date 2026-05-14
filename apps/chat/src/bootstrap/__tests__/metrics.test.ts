import { describe, it, expect } from "vitest";
import { createPromMetrics } from "../metrics.js";

// prom-client's default Registry is module-scoped, so createPromMetrics() can
// only be invoked once per test process. Share a single instance across the
// assertions below.
const metrics = createPromMetrics();

describe("chat createPromMetrics", () => {
  it("returns a SwitchboardMetrics instance with the five outcome-pattern series", () => {
    expect(metrics.outcomePatternsExtracted).toBeDefined();
    expect(metrics.outcomePatternsMerged).toBeDefined();
    expect(metrics.outcomePatternsCreated).toBeDefined();
    expect(metrics.outcomePatternsSurfaced).toBeDefined();
    expect(metrics.outcomePatternConfidence).toBeDefined();
  });

  it("inc() on a labeled counter does not throw", () => {
    expect(() => {
      metrics.outcomePatternsExtracted.inc({
        deployment_id: "dep-1",
        attribution_tier: "strong",
      });
    }).not.toThrow();
  });
});
