import { describe, it, expect } from "vitest";
import { applyBudgetCap, validateSpendIncrease } from "../budget-guardrails.js";

describe("applyBudgetCap", () => {
  it("returns proposed spend when no limits defined", () => {
    const result = applyBudgetCap(500, {});
    expect(result.cappedSpend).toBe(500);
    expect(result.limitApplied).toBeNull();
    expect(result.reasoning).toContain("No budget limits defined");
  });

  it("returns proposed spend when within all limits", () => {
    const result = applyBudgetCap(100, { maxDailySpend: 200, maxCampaignBudget: 500 });
    expect(result.cappedSpend).toBe(100);
    expect(result.limitApplied).toBeNull();
  });

  it("caps at the strictest limit", () => {
    const result = applyBudgetCap(1000, {
      maxDailySpend: 500,
      maxCampaignBudget: 300,
      maxInterventionSpend: 800,
    });
    expect(result.cappedSpend).toBe(300);
    expect(result.limitApplied).toBe("maxCampaignBudget");
  });

  it("caps at maxDailySpend when it is the strictest", () => {
    const result = applyBudgetCap(1000, {
      maxDailySpend: 200,
      maxCampaignBudget: 5000,
    });
    expect(result.cappedSpend).toBe(200);
    expect(result.limitApplied).toBe("maxDailySpend");
  });

  it("handles zero proposed spend", () => {
    const result = applyBudgetCap(0, { maxDailySpend: 200 });
    expect(result.cappedSpend).toBe(0);
    expect(result.reasoning).toContain("zero or negative");
  });

  it("handles negative proposed spend", () => {
    const result = applyBudgetCap(-100, { maxDailySpend: 200 });
    expect(result.cappedSpend).toBe(0);
  });

  it("handles single limit", () => {
    const result = applyBudgetCap(500, { maxInterventionSpend: 250 });
    expect(result.cappedSpend).toBe(250);
    expect(result.limitApplied).toBe("maxInterventionSpend");
  });

  it("includes reasoning with dollar amounts", () => {
    const result = applyBudgetCap(1000, { maxDailySpend: 500 });
    expect(result.reasoning).toContain("$1000.00");
    expect(result.reasoning).toContain("$500.00");
  });
});

describe("validateSpendIncrease", () => {
  it("allows increase within percentage limit", () => {
    // 100 → 120 = 20% increase, limit is 50%
    expect(validateSpendIncrease(100, 120, 50)).toBe(true);
  });

  it("rejects increase exceeding percentage limit", () => {
    // 100 → 200 = 100% increase, limit is 50%
    expect(validateSpendIncrease(100, 200, 50)).toBe(false);
  });

  it("allows decrease (negative increase)", () => {
    expect(validateSpendIncrease(100, 50, 20)).toBe(true);
  });

  it("allows increase exactly at the limit", () => {
    // 100 → 150 = 50% increase, limit is 50%
    expect(validateSpendIncrease(100, 150, 50)).toBe(true);
  });

  it("allows any positive spend when current is zero", () => {
    expect(validateSpendIncrease(0, 500, 20)).toBe(true);
  });

  it("rejects negative proposed spend when current is zero", () => {
    expect(validateSpendIncrease(0, -10, 20)).toBe(false);
  });

  it("allows same spend (0% increase)", () => {
    expect(validateSpendIncrease(100, 100, 10)).toBe(true);
  });
});
