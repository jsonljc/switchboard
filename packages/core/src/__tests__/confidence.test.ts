import { describe, it, expect } from "vitest";
import { computeConfidence } from "../engine/confidence.js";

describe("computeConfidence", () => {
  it("returns high confidence for low-risk action with complete params", () => {
    const result = computeConfidence({
      riskScore: 10,
      schemaComplete: true,
      hasRequiredParams: true,
      retrievalQuality: 0.9,
      toolSuccessRate: 1.0,
    });
    expect(result.level).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(0.75);
  });

  it("returns low confidence for high-risk action with missing params", () => {
    const result = computeConfidence({
      riskScore: 75,
      schemaComplete: false,
      hasRequiredParams: false,
      retrievalQuality: 0.3,
      toolSuccessRate: 0.5,
    });
    expect(result.level).toBe("low");
    expect(result.score).toBeLessThan(0.45);
  });

  it("returns medium confidence for moderate signals", () => {
    const result = computeConfidence({
      riskScore: 45,
      schemaComplete: true,
      hasRequiredParams: true,
      retrievalQuality: 0.6,
      toolSuccessRate: 0.8,
    });
    expect(result.level).toBe("medium");
    expect(result.score).toBeGreaterThanOrEqual(0.45);
    expect(result.score).toBeLessThan(0.75);
  });

  it("degrades confidence when schema incomplete even if risk is low", () => {
    const result = computeConfidence({
      riskScore: 10,
      schemaComplete: false,
      hasRequiredParams: false,
    });
    expect(result.level).not.toBe("high");
  });

  it("uses defaults for optional signals", () => {
    const result = computeConfidence({
      riskScore: 20,
      schemaComplete: true,
      hasRequiredParams: true,
    });
    // retrievalQuality defaults to 0.7, toolSuccessRate defaults to 0.8
    // risk: (1 - 20/100) * 0.3 = 0.24
    // schema: 1.0 * 0.3 = 0.30
    // retrieval: 0.7 * 0.2 = 0.14
    // tool: 0.8 * 0.2 = 0.16
    // total: 0.84 → high
    expect(result.level).toBe("high");
    expect(result.factors).toHaveLength(4);
  });

  it("includes all factors in result", () => {
    const result = computeConfidence({
      riskScore: 50,
      schemaComplete: true,
      hasRequiredParams: true,
      retrievalQuality: 0.5,
      toolSuccessRate: 0.9,
    });
    expect(result.factors).toEqual([
      { signal: "risk_score", value: 0.5, weight: 0.3 },
      { signal: "schema_complete", value: 1.0, weight: 0.3 },
      { signal: "retrieval_quality", value: 0.5, weight: 0.2 },
      { signal: "tool_success_rate", value: 0.9, weight: 0.2 },
    ]);
  });
});
