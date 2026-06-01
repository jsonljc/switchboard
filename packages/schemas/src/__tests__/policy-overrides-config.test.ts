import { describe, it, expect } from "vitest";
import {
  DeploymentPolicyOverridesSchema,
  resolvePolicyOverrides,
  resolveTrustLevelOverride,
  resolveSpendAutonomyEnabled,
} from "../policy-overrides-config.js";

describe("DeploymentPolicyOverridesSchema", () => {
  it("parses a fully-populated overrides object", () => {
    expect(
      DeploymentPolicyOverridesSchema.parse({
        circuitBreakerThreshold: 5,
        maxWritesPerHour: 100,
        allowedModelTiers: ["default", "premium"],
        spendApprovalThreshold: 25,
      }),
    ).toEqual({
      circuitBreakerThreshold: 5,
      maxWritesPerHour: 100,
      allowedModelTiers: ["default", "premium"],
      spendApprovalThreshold: 25,
    });
  });

  it("accepts an empty object (all fields optional)", () => {
    expect(DeploymentPolicyOverridesSchema.parse({})).toEqual({});
  });
});

describe("resolvePolicyOverrides", () => {
  it("returns undefined for null/undefined inputs", () => {
    expect(resolvePolicyOverrides(null)).toBeUndefined();
    expect(resolvePolicyOverrides(undefined)).toBeUndefined();
  });

  it("returns undefined when no policy fields are set on the row", () => {
    expect(
      resolvePolicyOverrides({
        circuitBreakerThreshold: null,
        maxWritesPerHour: null,
        allowedModelTiers: [],
        // spendApprovalThreshold is not a number on this row
      }),
    ).toBeUndefined();
  });

  it("extracts all four fields when populated", () => {
    expect(
      resolvePolicyOverrides({
        circuitBreakerThreshold: 5,
        maxWritesPerHour: 100,
        allowedModelTiers: ["default", "premium"],
        spendApprovalThreshold: 25,
      }),
    ).toEqual({
      circuitBreakerThreshold: 5,
      maxWritesPerHour: 100,
      allowedModelTiers: ["default", "premium"],
      spendApprovalThreshold: 25,
    });
  });

  it("includes only the fields that pass the type/non-empty checks", () => {
    expect(
      resolvePolicyOverrides({
        circuitBreakerThreshold: 5,
        maxWritesPerHour: null, // omitted
        allowedModelTiers: [], // omitted (empty)
        spendApprovalThreshold: "not a number", // omitted
      }),
    ).toEqual({ circuitBreakerThreshold: 5 });
  });

  it("omits allowedModelTiers when empty (matches legacy extractPolicyOverrides)", () => {
    const result = resolvePolicyOverrides({
      circuitBreakerThreshold: 3,
      allowedModelTiers: [],
    });
    expect(result).toEqual({ circuitBreakerThreshold: 3 });
    expect(result?.allowedModelTiers).toBeUndefined();
  });
});

describe("resolveTrustLevelOverride", () => {
  it("returns each valid runtime trust level", () => {
    expect(resolveTrustLevelOverride({ trustLevelOverride: "autonomous" })).toBe("autonomous");
    expect(resolveTrustLevelOverride({ trustLevelOverride: "guided" })).toBe("guided");
    expect(resolveTrustLevelOverride({ trustLevelOverride: "supervised" })).toBe("supervised");
  });

  it("returns undefined when the key is absent", () => {
    expect(resolveTrustLevelOverride({})).toBeUndefined();
    expect(resolveTrustLevelOverride({ somethingElse: "autonomous" })).toBeUndefined();
  });

  it("returns undefined for invalid or non-string values", () => {
    expect(resolveTrustLevelOverride({ trustLevelOverride: "yolo" })).toBeUndefined();
    expect(resolveTrustLevelOverride({ trustLevelOverride: 3 })).toBeUndefined();
    expect(resolveTrustLevelOverride({ trustLevelOverride: null })).toBeUndefined();
  });

  it("returns undefined for non-object inputs", () => {
    expect(resolveTrustLevelOverride(null)).toBeUndefined();
    expect(resolveTrustLevelOverride(undefined)).toBeUndefined();
    expect(resolveTrustLevelOverride("autonomous")).toBeUndefined();
  });
});

describe("resolveSpendAutonomyEnabled", () => {
  it("is true only when explicitly set to boolean true", () => {
    expect(resolveSpendAutonomyEnabled({ spendAutonomy: true })).toBe(true);
  });
  it("is false for absent, falsy, or truthy-but-not-true values (no silent opt-in)", () => {
    expect(resolveSpendAutonomyEnabled({})).toBe(false);
    expect(resolveSpendAutonomyEnabled({ spendAutonomy: false })).toBe(false);
    // A non-boolean truthy value must NOT opt in — only literal `true` does.
    expect(resolveSpendAutonomyEnabled({ spendAutonomy: "true" })).toBe(false);
    expect(resolveSpendAutonomyEnabled({ spendAutonomy: 1 })).toBe(false);
  });
  it("is false for non-object inputs", () => {
    expect(resolveSpendAutonomyEnabled(null)).toBe(false);
    expect(resolveSpendAutonomyEnabled(undefined)).toBe(false);
    expect(resolveSpendAutonomyEnabled("true")).toBe(false);
  });
});
