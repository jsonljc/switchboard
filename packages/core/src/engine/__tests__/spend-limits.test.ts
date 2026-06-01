import { describe, it, expect } from "vitest";
import type { ActionProposal } from "@switchboard/schemas";
import { extractSpendAmount } from "../spend-limits.js";

function proposal(parameters: Record<string, unknown>): ActionProposal {
  return {
    id: "a1",
    actionType: "x",
    parameters,
    evidence: "t",
    confidence: 1,
    originatingMessageId: "m1",
  };
}

describe("extractSpendAmount", () => {
  it("reads the canonical spendAmount key first", () => {
    expect(extractSpendAmount(proposal({ spendAmount: 120, amount: 5 }))).toBe(120);
  });
  it("falls back amount → budgetChange → newBudget", () => {
    expect(extractSpendAmount(proposal({ amount: 30 }))).toBe(30);
    expect(extractSpendAmount(proposal({ budgetChange: 40 }))).toBe(40);
    expect(extractSpendAmount(proposal({ newBudget: 50 }))).toBe(50);
  });
  it("returns null when no numeric spend field is present", () => {
    expect(extractSpendAmount(proposal({ note: "hi" }))).toBeNull();
    expect(extractSpendAmount(proposal({ amount: "30" }))).toBeNull();
  });
  it("ignores non-finite numbers", () => {
    expect(extractSpendAmount(proposal({ amount: NaN }))).toBeNull();
  });
});
