import { describe, it, expect } from "vitest";
import { buildRileyBudgetCandidate } from "../riley-budget-dispatch.js";

const context = { evidence: { clicks: 100, conversions: 10, days: 7 }, learningPhaseActive: false };
const base = {
  emitted: {
    recommendationId: "rec_1",
    actionType: "scale" as const,
    campaignId: "camp_1",
    rationale: "Campaign performing under target CPA, scale the daily budget up",
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
      rationale: "Campaign performing under target CPA, scale the daily budget up",
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

  // CONTRACT (P3-1): no candidate-side evidence floor. The base scale-family floor (30/3/7) is
  // enforced UPSTREAM at engine emission (recommendation-engine.ts Gate 2: a sub-floor scale rec is
  // demoted to an abstention WatchOutput and never reaches this builder as action:"scale"). So the
  // builder itself must NOT re-floor: it builds even on below-base-floor evidence. If a future change
  // adds a floor here, this test breaks and the reallocate-dispatch docstring must be re-checked.
  it("applies no candidate-side evidence floor: builds even on below-base-floor evidence", () => {
    const candidate = buildRileyBudgetCandidate({
      ...base,
      context: { evidence: { clicks: 1, conversions: 0, days: 1 }, learningPhaseActive: false },
    });
    expect(candidate).not.toBeNull();
    expect(candidate?.evidence).toEqual({ clicks: 1, conversions: 0, days: 1 });
  });

  // CONTRACT (P3-1): reallocate is not arbitration-primary-gated. The builder takes no index/
  // primaryIndex input, so two independent scale recs each build a candidate (no primary-only
  // collapse). The arbitrator's only primary-gated consumer is pause self-submission
  // (opportunity-arbitrator.ts); reallocate surfaces every well-formed winner for approval.
  it("is not primary-gated: independent scale recs each build a candidate", () => {
    const a = buildRileyBudgetCandidate({
      ...base,
      emitted: { ...base.emitted, recommendationId: "rec_a", campaignId: "camp_a" },
    });
    const b = buildRileyBudgetCandidate({
      ...base,
      emitted: { ...base.emitted, recommendationId: "rec_b", campaignId: "camp_b" },
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});
