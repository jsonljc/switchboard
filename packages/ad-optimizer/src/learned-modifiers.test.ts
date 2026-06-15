import { describe, it, expect, vi } from "vitest";
import { resolveLearnedModifiers } from "./learned-modifiers.js";

describe("resolveLearnedModifiers", () => {
  it("returns no modifiers when no providers are wired (back-compat)", async () => {
    const m = await resolveLearnedModifiers({}, "org-1");
    expect(m.confidenceModifierByKind).toBeUndefined();
    expect(m.outcomeMultiplierByKind).toBeUndefined();
  });

  it("builds the approval modifier from the approval provider (abstains on no history, nudges over floor)", async () => {
    const approvalRateProvider = vi
      .fn()
      .mockResolvedValue(new Map([["pause", { approved: 18, rejected: 2 }]])); // 90% over 20 -> 1.15
    const m = await resolveLearnedModifiers({ approvalRateProvider }, "org-1");
    expect(approvalRateProvider).toHaveBeenCalledWith("org-1");
    expect(m.confidenceModifierByKind?.("pause")).toBeCloseTo(1.15, 5);
    expect(m.confidenceModifierByKind?.("unknown")).toBe(1.0); // no history -> abstain
    expect(m.outcomeMultiplierByKind).toBeUndefined();
  });

  it("builds the outcome multiplier from the outcome provider (corroboration-gated)", async () => {
    const outcomeSignalProvider = vi
      .fn()
      .mockResolvedValue(new Map([["pause", { corroboratedUp: 4, corroboratedDown: 0 }]])); // -> 1.1
    const m = await resolveLearnedModifiers({ outcomeSignalProvider }, "org-9");
    expect(outcomeSignalProvider).toHaveBeenCalledWith("org-9");
    expect(m.outcomeMultiplierByKind?.("pause")).toBeCloseTo(1.1, 5);
    expect(m.outcomeMultiplierByKind?.("unknown")).toBe(1.0); // abstain
    expect(m.confidenceModifierByKind).toBeUndefined();
  });
});
