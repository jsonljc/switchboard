// Spec-1B reallocate dispatch through the sink (P3-1 contract guard). The reallocate/budget path is
// deliberately NOT a copy of the pause path: it is NOT arbitration-primary-gated. Where the pause
// dispatch self-submits ONLY the arbitration-primary pause (recommendation-sink-pause-dispatch.test
// .ts), the budget path self-submits EVERY well-formed `scale` reallocation, even one that is not the
// arbitration primary. These tests pin that property at the sink, the layer where it actually lives
// (the builder takes no index input). Same fixture conventions as the pause-dispatch sink test.
import { describe, expect, it, vi } from "vitest";
import { runRecommendationSink } from "../recommendation-sink.js";
import type { EmitOutcome, RecommendationEmitter } from "../recommendation-sink.js";
import type { RecommendationOutput } from "../recommendation-engine.js";
import { resetsLearningFor } from "../action-reset-classification.js";

const baseRec = (overrides: Partial<RecommendationOutput> = {}): RecommendationOutput => {
  const action = overrides.action ?? "scale";
  return {
    type: "recommendation",
    campaignId: "c-1",
    campaignName: "Whitening Set B",
    action,
    confidence: 0.9,
    urgency: "immediate",
    estimatedImpact: "scale the winner",
    steps: ["Scale 20%"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
    ...overrides,
  };
};

describe("runRecommendationSink: Spec-1B reallocate dispatch (not primary-gated)", () => {
  const scaleRec = (campaignId: string) =>
    baseRec({ action: "scale", campaignId, campaignName: `Campaign ${campaignId}` });
  const pauseRec = (campaignId: string) =>
    baseRec({ action: "pause", campaignId, campaignName: `Campaign ${campaignId}` });
  const ctx = () => ({
    evidence: { clicks: 1000, conversions: 100, days: 30 },
    learningPhaseActive: false,
  });
  const emitWithIds = (): RecommendationEmitter => {
    let n = 0;
    return vi.fn(async () => ({ surface: "queue" as const, id: `rec_db_${++n}` }) as EmitOutcome);
  };
  const budgetSubmitter = () =>
    vi.fn(async (_c: unknown) => ({ parked: true })) as ReturnType<typeof vi.fn> &
      ((c: unknown) => Promise<{ parked: boolean }>);

  it("self-submits EVERY scale reallocation, not just the arbitration primary (two scales both dispatch)", async () => {
    const rileyBudgetSubmitter = budgetSubmitter();
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [scaleRec("camp_a"), scaleRec("camp_b")],
      emit: emitWithIds(),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([
        ["camp_a", ctx()],
        ["camp_b", ctx()],
      ]),
      rileyBudgetSubmitter,
      adAccountId: "act_123",
      currentDailyBudgetCentsByCampaign: new Map([
        ["camp_a", 5000],
        ["camp_b", 7000],
      ]),
    });
    // Both scales self-submit. The pause path would collapse two pauses to ONE (the primary); the
    // reallocate path has no such collapse, which is exactly the property the P3-1 docstring asserts.
    expect(rileyBudgetSubmitter).toHaveBeenCalledTimes(2);
  });

  it("a non-primary scale still dispatches even when a pause is the arbitration primary", async () => {
    const rileyBudgetSubmitter = budgetSubmitter();
    // The pause at index 0 is the arbitration primary; the scale at index 1 is NOT. If the budget path
    // were arbitration-gated it would abstain; it does not, so the scale self-submits regardless.
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-2",
      recommendations: [pauseRec("camp_p"), scaleRec("camp_s")],
      emit: emitWithIds(),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([
        ["camp_p", ctx()],
        ["camp_s", ctx()],
      ]),
      rileyBudgetSubmitter,
      adAccountId: "act_123",
      currentDailyBudgetCentsByCampaign: new Map([["camp_s", 5000]]),
      pausePrimaryIndex: 0,
    });
    expect(rileyBudgetSubmitter).toHaveBeenCalledTimes(1);
    expect(rileyBudgetSubmitter.mock.calls[0]![0]).toMatchObject({
      campaignId: "camp_s",
      currentDailyBudgetCents: 5000,
    });
  });

  it("flag-off (no budget submitter) means no reallocation dispatch", async () => {
    // No rileyBudgetSubmitter -> the gate at recommendation-sink.ts is false -> entirely inert.
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-3",
      recommendations: [scaleRec("camp_a")],
      emit: emitWithIds(),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([["camp_a", ctx()]]),
      adAccountId: "act_123",
      currentDailyBudgetCentsByCampaign: new Map([["camp_a", 5000]]),
    });
    expect(result.routedQueue).toBe(1);
  });
});
