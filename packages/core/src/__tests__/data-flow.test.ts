import { describe, it, expect } from "vitest";
import { resolveBindings, BindingResolutionError } from "../data-flow/resolver.js";
import { evaluateCondition } from "../data-flow/condition.js";
import type { StepExecutionResult } from "../data-flow/types.js";

function makeStepResult(overrides: Partial<StepExecutionResult> = {}): StepExecutionResult {
  return {
    stepIndex: 0,
    resolvedParameters: {},
    conditionMet: true,
    envelopeId: "env_1",
    outcome: "executed",
    result: {
      success: true,
      summary: "OK",
      externalRefs: { invoiceId: "inv_1" },
      data: { value: 4000, treatmentType: "dental_crown" },
    },
    error: null,
    ...overrides,
  };
}

describe("resolveBindings", () => {
  it("resolves $prev.result paths", async () => {
    const stepResults = [
      makeStepResult({
        stepIndex: 0,
        result: {
          success: true,
          data: { value: 4000, treatmentType: "dental_crown" },
          externalRefs: { invoiceId: "inv_1" },
        },
      }),
    ];

    const params = {
      amount: "$prev.result.data.value",
      description: "static value",
    };

    const resolved = await resolveBindings(params, 1, { stepResults });
    expect(resolved.amount).toBe(4000);
    expect(resolved.description).toBe("static value");
  });

  it("resolves $step[N] paths", async () => {
    const stepResults = [
      makeStepResult({
        stepIndex: 0,
        result: {
          success: true,
          data: { value: 4000, treatmentType: "dental_crown" },
        },
      }),
    ];

    const params = {
      type: "$step[0].result.data.treatmentType",
    };

    const resolved = await resolveBindings(params, 1, { stepResults });
    expect(resolved.type).toBe("dental_crown");
  });

  it("throws BindingResolutionError for $prev on step 0", async () => {
    await expect(
      resolveBindings({ x: "$prev.result.success" }, 0, { stepResults: [] }),
    ).rejects.toThrow(BindingResolutionError);
  });

  it("throws BindingResolutionError for missing step result", async () => {
    await expect(
      resolveBindings({ x: "$step[5].result.data" }, 1, { stepResults: [] }),
    ).rejects.toThrow(BindingResolutionError);
  });

  it("passes through non-binding values", async () => {
    const resolved = await resolveBindings({ name: "hello", count: 42, flag: true }, 0, {
      stepResults: [],
    });
    expect(resolved).toEqual({ name: "hello", count: 42, flag: true });
  });

  it("resolves arrays with bindings", async () => {
    const stepResults = [makeStepResult({ result: { data: { id: "ct_1" } } })];
    const params = { ids: ["$step[0].result.data.id", "static_id"] };
    const resolved = await resolveBindings(params, 1, { stepResults });
    expect(resolved.ids).toEqual(["ct_1", "static_id"]);
  });

  it("resolves nested objects with bindings", async () => {
    const stepResults = [makeStepResult({ result: { data: { amount: 500 } } })];
    const params = {
      payment: { amount: "$step[0].result.data.amount", currency: "USD" },
    };
    const resolved = await resolveBindings(params, 1, { stepResults });
    expect(resolved.payment).toEqual({ amount: 500, currency: "USD" });
  });
});

describe("evaluateCondition", () => {
  it("returns true for null condition", () => {
    expect(evaluateCondition(null, 0, [])).toBe(true);
  });

  it("returns true for empty string condition", () => {
    expect(evaluateCondition("", 0, [])).toBe(true);
  });

  it("evaluates === true condition", () => {
    const results = [makeStepResult({ result: { success: true } })];
    expect(evaluateCondition("$prev.result.success === true", 1, results)).toBe(true);
    expect(evaluateCondition("$prev.result.success === false", 1, results)).toBe(false);
  });

  it("evaluates numeric > condition", () => {
    const results = [makeStepResult({ result: { data: { value: 5000 } } })];
    expect(evaluateCondition("$prev.result.data.value > 1000", 1, results)).toBe(true);
    expect(evaluateCondition("$prev.result.data.value > 10000", 1, results)).toBe(false);
  });

  it("evaluates $step[N] references", () => {
    const results = [makeStepResult({ outcome: "executed" })];
    expect(evaluateCondition("$step[0].outcome === 'executed'", 1, results)).toBe(true);
    expect(evaluateCondition("$step[0].outcome === 'denied'", 1, results)).toBe(false);
  });

  it("returns true for unparseable conditions", () => {
    expect(evaluateCondition("some random text", 0, [])).toBe(true);
  });
});
