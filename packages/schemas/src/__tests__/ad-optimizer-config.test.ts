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

  // A21: the booked-CAC target is ALSO an operator form value (a future wizard
  // field), so it must coerce string -> number like the others. Unlike targetCPA/
  // targetROAS it has NO default: an unset target means "no booked_cac tier", which
  // must stay genuinely unset (undefined), never a silent 0.
  it("coerces a numeric-string targetCostPerBooked to a number", () => {
    expect(AdOptimizerConfigSchema.parse({ targetCostPerBooked: "1500" })).toMatchObject({
      targetCostPerBooked: 1500,
    });
  });

  it("leaves targetCostPerBooked unset (undefined) when absent — no silent default", () => {
    expect(AdOptimizerConfigSchema.parse({}).targetCostPerBooked).toBeUndefined();
  });

  it("treats an empty-string targetCostPerBooked as unset (not 0)", () => {
    expect(AdOptimizerConfigSchema.parse({ targetCostPerBooked: "" }).targetCostPerBooked).toBe(
      undefined,
    );
  });

  it("rejects a malformed targetCostPerBooked (currency/percent text) rather than coercing to NaN", () => {
    expect(() => AdOptimizerConfigSchema.parse({ targetCostPerBooked: "$1,500" })).toThrow();
    expect(() => AdOptimizerConfigSchema.parse({ targetCostPerBooked: "30%" })).toThrow();
  });

  // PR-C.1 (#510): the preprocess strips empty-ish inputs so .default()
  // fires instead of z.coerce.number() silently producing 0. Without
  // this, an operator who clears the marketplace form field saves an
  // empty string and the LLM/audit-engine sees targetCPA=0.
  it("treats empty-string inputs as missing (falls back to defaults)", () => {
    expect(
      AdOptimizerConfigSchema.parse({ targetCPA: "", targetROAS: "", monthlyBudget: "" }),
    ).toEqual({ targetCPA: 100, targetROAS: 3, monthlyBudget: 0 });
  });

  it("treats null inputs as missing (falls back to defaults)", () => {
    expect(
      AdOptimizerConfigSchema.parse({ targetCPA: null, targetROAS: null, monthlyBudget: null }),
    ).toEqual({ targetCPA: 100, targetROAS: 3, monthlyBudget: 0 });
  });

  it("treats whitespace-only strings as missing", () => {
    expect(AdOptimizerConfigSchema.parse({ targetCPA: "   ", targetROAS: "\t\n" })).toEqual({
      targetCPA: 100,
      targetROAS: 3,
      monthlyBudget: 0,
    });
  });

  // The preprocess scope is narrow on purpose: it fixes the cleared-form
  // path (`""` / null / whitespace), which is the only path operators
  // actually hit. Other surprising z.coerce.number() inputs (`false` → 0,
  // `[42]` → 42, `true` → 1) are not on the operator path and aren't
  // covered by this fix. If a future caller starts passing non-string,
  // non-number values into inputConfig, tighten the preprocess then.
  it("[known limitation] boolean false still coerces to 0 (not on operator path)", () => {
    expect(AdOptimizerConfigSchema.parse({ targetCPA: false })).toMatchObject({
      targetCPA: 0,
    });
  });

  it("[known limitation] single-element array still coerces to its element (not on operator path)", () => {
    expect(AdOptimizerConfigSchema.parse({ targetCPA: [42] })).toMatchObject({
      targetCPA: 42,
    });
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
