import { describe, it, expect } from "vitest";
import { evaluateRule } from "../engine/rule-evaluator.js";
import type { EvaluationContext } from "../engine/rule-evaluator.js";

describe("evaluateRule ReDoS protection (#9)", () => {
  const baseContext: EvaluationContext = {
    actionType: "test.action",
    parameters: { value: "a".repeat(10001) },
    cartridgeId: "test",
    principalId: "user_1",
    organizationId: null,
    riskCategory: "low",
    metadata: {},
  };

  it("should reject patterns exceeding 256 characters", () => {
    const result = evaluateRule(
      {
        composition: "AND",
        conditions: [
          { field: "parameters.value", operator: "matches", value: "a".repeat(257) },
        ],
      },
      { ...baseContext, parameters: { value: "test" } },
    );
    expect(result.matched).toBe(false);
  });

  it("should reject inputs exceeding 10000 characters", () => {
    const result = evaluateRule(
      {
        composition: "AND",
        conditions: [
          { field: "parameters.value", operator: "matches", value: "a+" },
        ],
      },
      baseContext,
    );
    expect(result.matched).toBe(false);
  });

  it("should reject repeated wildcard patterns", () => {
    const result = evaluateRule(
      {
        composition: "AND",
        conditions: [
          { field: "parameters.value", operator: "matches", value: "(.*)(.*)" },
        ],
      },
      { ...baseContext, parameters: { value: "test" } },
    );
    expect(result.matched).toBe(false);
  });

  it("should still allow safe patterns", () => {
    const result = evaluateRule(
      {
        composition: "AND",
        conditions: [
          { field: "parameters.value", operator: "matches", value: "^hello.*world$" },
        ],
      },
      { ...baseContext, parameters: { value: "hello beautiful world" } },
    );
    expect(result.matched).toBe(true);
  });
});
