import { describe, it, expect } from "vitest";
import { computeExecutionCostUSD } from "./llm-costs.js";

describe("computeExecutionCostUSD", () => {
  it("normalizes the router's full model ids to the price table", () => {
    const r = computeExecutionCostUSD({
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 1000,
    });
    // sonnet: 0.003 in + 0.015 out per 1k
    expect(r.totalCost).toBeCloseTo(0.018, 6);
  });
  it("prices cache reads at a discount and cache creation at a premium", () => {
    const r = computeExecutionCostUSD({
      model: "claude-haiku-4-5-20251001",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 10_000, // 10k * (0.001 * 0.1)/1k = 0.001
      cacheCreationTokens: 10_000, // 10k * (0.001 * 1.25)/1k = 0.0125
    });
    expect(r.totalCost).toBeCloseTo(0.001 + 0.0125, 6);
  });
  it("falls back to default (sonnet) pricing for an unknown model", () => {
    const r = computeExecutionCostUSD({
      model: "totally-unknown-model",
      inputTokens: 1000,
      outputTokens: 0,
    });
    // unknown id → default sonnet input rate: 1000 * (0.003/1000) = 0.003
    expect(r.totalCost).toBeCloseTo(0.003, 6);
  });
  it("prices a cache-only call with no model at the default sonnet cache-read rate", () => {
    const r = computeExecutionCostUSD({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1000, // 1000 * (0.003/1000) * 0.1 = 0.0003
    });
    expect(r.totalCost).toBeCloseTo(0.0003, 6);
  });
});
