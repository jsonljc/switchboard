import { describe, it, expect } from "vitest";
import { buildRileyBudgetCandidate } from "../riley-budget-dispatch.js";

const context = { evidence: { clicks: 100, conversions: 10, days: 7 }, learningPhaseActive: false };
const base = {
  emitted: {
    recommendationId: "rec_1",
    actionType: "shift_budget_to_source" as const,
    campaignId: "camp_1",
    rationale: "Shift budget toward the higher-paid source",
    surface: "queue" as const,
  },
  currentDailyBudgetCents: 5000 as number | null,
  proposedDailyBudgetCents: 8000 as number | null,
  context,
  organizationId: "org-1",
  deploymentId: "dep-riley",
  adAccountId: "act_123",
};

describe("buildRileyBudgetCandidate (Spec-1B reallocation producer)", () => {
  it("builds a candidate from a valid reallocation recommendation", () => {
    expect(buildRileyBudgetCandidate(base)).toEqual({
      organizationId: "org-1",
      deploymentId: "dep-riley",
      adAccountId: "act_123",
      recommendationId: "rec_1",
      campaignId: "camp_1",
      currentDailyBudgetCents: 5000,
      proposedDailyBudgetCents: 8000,
      rationale: "Shift budget toward the higher-paid source",
      evidence: { clicks: 100, conversions: 10, days: 7 },
    });
  });
  it("abstains on a non-reallocation action (e.g. pause)", () => {
    expect(
      buildRileyBudgetCandidate({ ...base, emitted: { ...base.emitted, actionType: "pause" } }),
    ).toBeNull();
  });
  it("abstains on a dropped surface", () => {
    expect(
      buildRileyBudgetCandidate({ ...base, emitted: { ...base.emitted, surface: "dropped" } }),
    ).toBeNull();
  });
  it("abstains without per-campaign context", () => {
    expect(buildRileyBudgetCandidate({ ...base, context: undefined })).toBeNull();
  });
  it("abstains without an adAccountId (the executor must act against the approved account)", () => {
    expect(buildRileyBudgetCandidate({ ...base, adAccountId: "" })).toBeNull();
  });
  it("abstains when the current budget is unknown (null - cannot size the move)", () => {
    expect(buildRileyBudgetCandidate({ ...base, currentDailyBudgetCents: null })).toBeNull();
  });
  it("abstains on a zero-delta no-op (current == proposed)", () => {
    expect(buildRileyBudgetCandidate({ ...base, proposedDailyBudgetCents: 5000 })).toBeNull();
  });
});
