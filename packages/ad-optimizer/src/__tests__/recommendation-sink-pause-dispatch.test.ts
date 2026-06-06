// Phase-C pause dispatch through the sink (primary-only, park truth). Extracted
// from recommendation-sink.test.ts to keep that file under the max-lines gate;
// same fixture conventions (baseRec mirrors the sink test's).
import { describe, expect, it, vi } from "vitest";
import { runRecommendationSink } from "../recommendation-sink.js";
import type { EmitOutcome, RecommendationEmitter } from "../recommendation-sink.js";
import type { RecommendationOutput } from "../recommendation-engine.js";
import { resetsLearningFor } from "../action-reset-classification.js";

const baseRec = (overrides: Partial<RecommendationOutput> = {}): RecommendationOutput => {
  const action = overrides.action ?? "pause";
  return {
    type: "recommendation",
    campaignId: "c-1",
    campaignName: "Whitening Set B",
    action,
    confidence: 0.9,
    urgency: "immediate",
    estimatedImpact: "saves $40/day",
    steps: ["Pause"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
    ...overrides,
  };
};

describe("runRecommendationSink — Phase-C pause dispatch (primary-only, park truth)", () => {
  const pauseRec = (campaignId: string) =>
    baseRec({ action: "pause", campaignId, campaignName: `Campaign ${campaignId}` });
  // Clears the RAISED execution floor {clicks: 100, conversions: 10, days: 7}.
  const strongCtx = () => ({
    evidence: { clicks: 1000, conversions: 100, days: 30 },
    learningPhaseActive: false,
  });
  const emitWithIds = (): RecommendationEmitter => {
    let n = 0;
    return vi.fn(async () => ({ surface: "queue" as const, id: `rec_db_${++n}` }) as EmitOutcome);
  };
  const parkedSubmitter = () =>
    vi.fn(async (_c: unknown) => ({ parked: true })) as ReturnType<typeof vi.fn> &
      ((c: unknown) => Promise<{ parked: boolean }>);

  it("dispatches ONLY the arbitration-primary pause and records park truth", async () => {
    const rileyPauseSubmitter = parkedSubmitter();
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [pauseRec("camp_a"), pauseRec("camp_b")],
      emit: emitWithIds(),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([
        ["camp_a", strongCtx()],
        ["camp_b", strongCtx()],
      ]),
      rileyPauseSubmitter,
      pausePrimaryIndex: 1,
    });
    expect(rileyPauseSubmitter).toHaveBeenCalledTimes(1);
    expect(rileyPauseSubmitter.mock.calls[0]![0]).toMatchObject({
      organizationId: "org-1",
      deploymentId: "dep_riley",
      recommendationId: "rec_db_2",
      campaignId: "camp_b",
      evidence: { clicks: 1000, conversions: 100, days: 30 },
    });
    expect(result.pauseParkedIndex).toBe(1);
  });

  it("pauseParkedIndex stays undefined when the submitter reports not-parked", async () => {
    const rileyPauseSubmitter = vi.fn(async (_c: unknown) => ({ parked: false }));
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [pauseRec("camp_a")],
      emit: emitWithIds(),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([["camp_a", strongCtx()]]),
      rileyPauseSubmitter,
      pausePrimaryIndex: 0,
    });
    expect(rileyPauseSubmitter).toHaveBeenCalledTimes(1);
    expect(result.pauseParkedIndex).toBeUndefined();
  });

  it("no dispatch when: submitter absent / no primary index / context misses the campaign / no persisted id", async () => {
    // (a) submitter absent: nothing to call, park index undefined.
    const a = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-a",
      recommendations: [pauseRec("camp_a")],
      emit: emitWithIds(),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([["camp_a", strongCtx()]]),
      pausePrimaryIndex: 0,
    });
    expect(a.pauseParkedIndex).toBeUndefined();

    // (b) primary index undefined (no pause primary this cycle).
    const sb = parkedSubmitter();
    const b = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-b",
      recommendations: [pauseRec("camp_a")],
      emit: emitWithIds(),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([["camp_a", strongCtx()]]),
      rileyPauseSubmitter: sb,
    });
    expect(sb).not.toHaveBeenCalled();
    expect(b.pauseParkedIndex).toBeUndefined();

    // (c) the evidence map has another campaign only.
    const sc = parkedSubmitter();
    const c = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-c",
      recommendations: [pauseRec("camp_a")],
      emit: emitWithIds(),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([["camp_OTHER", strongCtx()]]),
      rileyPauseSubmitter: sc,
      pausePrimaryIndex: 0,
    });
    expect(sc).not.toHaveBeenCalled();
    expect(c.pauseParkedIndex).toBeUndefined();

    // (d) emitter yields no persisted id for the primary pause.
    const sd = parkedSubmitter();
    const d = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-d",
      recommendations: [pauseRec("camp_a")],
      emit: vi.fn(async () => ({ surface: "queue" }) as EmitOutcome),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([["camp_a", strongCtx()]]),
      rileyPauseSubmitter: sd,
      pausePrimaryIndex: 0,
    });
    expect(sd).not.toHaveBeenCalled();
    expect(d.pauseParkedIndex).toBeUndefined();
  });

  it("a throwing pause submitter is safe (sink completes; park index undefined)", async () => {
    const rileyPauseSubmitter = vi.fn(async (_c: unknown) => {
      throw new Error("ingress down");
    });
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [pauseRec("camp_a")],
      emit: emitWithIds(),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      campaignEvidenceByCampaign: new Map([["camp_a", strongCtx()]]),
      rileyPauseSubmitter,
      pausePrimaryIndex: 0,
    });
    expect(result.routedQueue).toBe(1);
    expect(result.pauseParkedIndex).toBeUndefined();
  });
});
