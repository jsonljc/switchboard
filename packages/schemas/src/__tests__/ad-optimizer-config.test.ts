import { describe, it, expect } from "vitest";
import { AdOptimizerConfigSchema, resolveAdOptimizerConfig } from "../ad-optimizer-config.js";

describe("AdOptimizerConfigSchema", () => {
  it("applies defaults when input is empty", () => {
    expect(AdOptimizerConfigSchema.parse({})).toEqual({
      targetCPA: 100,
      targetROAS: 3,
      monthlyBudget: 0,
    });
  });

  it("accepts explicit overrides", () => {
    expect(
      AdOptimizerConfigSchema.parse({ targetCPA: 50, targetROAS: 4, monthlyBudget: 10_000 }),
    ).toEqual({ targetCPA: 50, targetROAS: 4, monthlyBudget: 10_000 });
  });

  it("preserves unknown keys via .passthrough() (DEPLOYMENT_CONFIG bag survives)", () => {
    expect(
      AdOptimizerConfigSchema.parse({
        targetCPA: 25,
        pixelId: "fb_pix_123",
        auditFrequency: "weekly",
      }),
    ).toEqual({
      targetCPA: 25,
      targetROAS: 3,
      monthlyBudget: 0,
      pixelId: "fb_pix_123",
      auditFrequency: "weekly",
    });
  });

  it("coerces numeric-string inputs (operator-entered form values stored as text)", () => {
    expect(
      AdOptimizerConfigSchema.parse({
        targetCPA: "30",
        targetROAS: "2.5",
        monthlyBudget: "3000",
      }),
    ).toEqual({ targetCPA: 30, targetROAS: 2.5, monthlyBudget: 3000 });
  });

  it("rejects negative numbers", () => {
    expect(() => AdOptimizerConfigSchema.parse({ targetCPA: -1 })).toThrow();
  });

  it("rejects non-numeric strings", () => {
    expect(() => AdOptimizerConfigSchema.parse({ targetCPA: "not-a-number" })).toThrow();
  });
});

describe("resolveAdOptimizerConfig", () => {
  it("returns defaults when inputConfig is null/undefined", () => {
    expect(resolveAdOptimizerConfig(null)).toEqual({
      targetCPA: 100,
      targetROAS: 3,
      monthlyBudget: 0,
    });
    expect(resolveAdOptimizerConfig(undefined)).toEqual({
      targetCPA: 100,
      targetROAS: 3,
      monthlyBudget: 0,
    });
  });

  it("reads top-level fields from inputConfig (no nested namespace)", () => {
    expect(
      resolveAdOptimizerConfig({ targetCPA: 75, targetROAS: 2.5, monthlyBudget: 5000 }),
    ).toEqual({ targetCPA: 75, targetROAS: 2.5, monthlyBudget: 5000 });
  });

  it("forwards unknown keys for downstream consumers (LLM prompt input)", () => {
    const result = resolveAdOptimizerConfig({
      targetCPA: 60,
      pixelId: "fb_pix_999",
    });
    expect(result.pixelId).toBe("fb_pix_999");
  });
});
