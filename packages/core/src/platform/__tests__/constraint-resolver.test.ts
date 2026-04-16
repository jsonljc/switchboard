import { describe, it, expect } from "vitest";
import { resolveConstraints, DEFAULT_CONSTRAINTS } from "../governance/constraint-resolver.js";
import type { IntentRegistration } from "../intent-registration.js";

function makeRegistration(overrides?: Partial<IntentRegistration>): IntentRegistration {
  return {
    intent: "crm.deal.update",
    defaultMode: "skill",
    allowedModes: ["skill"],
    executor: { mode: "skill", skillSlug: "update-deal" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "standard",
    approvalPolicy: "none",
    idempotent: false,
    allowedTriggers: ["chat", "api"],
    timeoutMs: 30_000,
    retryable: false,
    ...overrides,
  };
}

describe("resolveConstraints", () => {
  it("uses cheap budget limits for cheap registrations", () => {
    const reg = makeRegistration({ budgetClass: "cheap" });
    const result = resolveConstraints(reg);
    expect(result.maxTotalTokens).toBe(32_000);
    expect(result.maxLlmTurns).toBe(3);
    expect(result.allowedModelTiers).toEqual(["default"]);
  });

  it("uses expensive budget limits for expensive registrations", () => {
    const reg = makeRegistration({ budgetClass: "expensive" });
    const result = resolveConstraints(reg);
    expect(result.maxTotalTokens).toBe(128_000);
    expect(result.maxLlmTurns).toBe(10);
    expect(result.allowedModelTiers).toEqual(["default", "premium", "critical"]);
  });

  it("maps timeoutMs to maxRuntimeMs", () => {
    const reg = makeRegistration({ timeoutMs: 60_000 });
    const result = resolveConstraints(reg);
    expect(result.maxRuntimeMs).toBe(60_000);
  });

  it("applies trustLevel override", () => {
    const reg = makeRegistration();
    const result = resolveConstraints(reg, { trustLevel: "autonomous" });
    expect(result.trustLevel).toBe("autonomous");
  });

  it("uses guided as default trustLevel", () => {
    const reg = makeRegistration();
    const result = resolveConstraints(reg);
    expect(result.trustLevel).toBe("guided");
  });

  it("uses defaults for non-budget fields when no overrides", () => {
    const reg = makeRegistration();
    const result = resolveConstraints(reg);
    expect(result.maxToolCalls).toBe(DEFAULT_CONSTRAINTS.maxToolCalls);
    expect(result.maxWritesPerExecution).toBe(DEFAULT_CONSTRAINTS.maxWritesPerExecution);
  });

  it("allows overriding all fields", () => {
    const reg = makeRegistration();
    const result = resolveConstraints(reg, {
      maxToolCalls: 50,
      maxWritesPerExecution: 10,
      maxTotalTokens: 200_000,
      maxLlmTurns: 20,
      maxRuntimeMs: 120_000,
      allowedModelTiers: ["critical"],
      trustLevel: "supervised",
    });
    expect(result.maxToolCalls).toBe(50);
    expect(result.maxWritesPerExecution).toBe(10);
    expect(result.maxTotalTokens).toBe(200_000);
    expect(result.maxLlmTurns).toBe(20);
    expect(result.maxRuntimeMs).toBe(120_000);
    expect(result.allowedModelTiers).toEqual(["critical"]);
    expect(result.trustLevel).toBe("supervised");
  });
});
