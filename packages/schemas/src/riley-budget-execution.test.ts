import { describe, it, expect } from "vitest";
import { RileyBudgetExecutionInput } from "./riley-budget-execution.js";

const valid = {
  recommendationId: "rec_1",
  actionType: "scale",
  adAccountId: "act_1",
  campaignId: "camp_1",
  fromCents: 5000,
  toCents: 6000,
};

describe("RileyBudgetExecutionInput", () => {
  it("accepts a valid frozen reallocate payload (extra params stripped)", () => {
    const parsed = RileyBudgetExecutionInput.safeParse({
      ...valid,
      spendAmount: 10,
      rationale: "scale up the winner",
      evidence: { clicks: 1 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.fromCents).toBe(5000);
      expect("spendAmount" in parsed.data).toBe(false);
    }
  });

  it("rejects a non-scale actionType (pause/review_budget are not this executor)", () => {
    expect(RileyBudgetExecutionInput.safeParse({ ...valid, actionType: "pause" }).success).toBe(
      false,
    );
  });

  it("rejects non-integer cents", () => {
    expect(RileyBudgetExecutionInput.safeParse({ ...valid, toCents: 6000.5 }).success).toBe(false);
  });

  it("rejects non-positive cents", () => {
    expect(RileyBudgetExecutionInput.safeParse({ ...valid, fromCents: 0 }).success).toBe(false);
    expect(RileyBudgetExecutionInput.safeParse({ ...valid, toCents: -1 }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    expect(RileyBudgetExecutionInput.safeParse({ recommendationId: "rec_1" }).success).toBe(false);
  });
});
