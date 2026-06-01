import { describe, expect, it, vi } from "vitest";
import { runRecommendationSink } from "../recommendation-sink.js";
import type { EmitOutcome, RecommendationEmitter } from "../recommendation-sink.js";
import type { RecommendationOutput } from "../recommendation-engine.js";
import type { RecommendationInput } from "@switchboard/schemas";

const baseRec = (overrides: Partial<RecommendationOutput> = {}): RecommendationOutput => ({
  type: "recommendation",
  campaignId: "c-1",
  campaignName: "Whitening Set B",
  action: "pause",
  confidence: 0.9,
  urgency: "immediate",
  estimatedImpact: "saves $40/day",
  steps: ["Pause"],
  learningPhaseImpact: "no impact",
  ...overrides,
});

/**
 * Mirror the v1 router's surface decision (router.ts in @switchboard/core).
 * Hardcoded here because the sink test should not pull a layer-violating import
 * on core; the router contract is small and stable.
 */
function mockRoute(input: RecommendationInput): EmitOutcome {
  const reversible = input.action === "pause" || input.action === "reduce_budget";
  if (reversible && input.confidence >= 0.85 && input.dollarsAtRisk < 50) {
    return { surface: "shadow_action" };
  }
  if (input.confidence >= 0.5) return { surface: "queue" };
  return { surface: "dropped" };
}

describe("runRecommendationSink", () => {
  it("emits one Recommendation per output via the emitter", async () => {
    const emit: RecommendationEmitter = vi.fn(async (input) => mockRoute(input));
    const recs = [baseRec(), baseRec({ campaignId: "c-2", action: "add_creative" })];
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: recs,
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(result.routedQueue + result.routedShadow + result.dropped).toBe(2);
    expect(emit).toHaveBeenCalledTimes(2);
    const firstCallArg = (emit as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(firstCallArg.agentKey).toBe("riley");
  });

  it("returns dropped count when low-confidence inputs route to dropped", async () => {
    const emit: RecommendationEmitter = vi.fn(async (input) => mockRoute(input));
    const recs = [
      baseRec({ confidence: 0.3 }), // dropped (below queueMinConfidence 0.5)
      baseRec({ confidence: 0.9 }), // queue or shadow
    ];
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-2",
      recommendations: recs,
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(result.dropped).toBeGreaterThan(0);
    // The sink emits unconditionally — the router decides surface. Both recs
    // go through emit; only the second contributes to a non-dropped surface.
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("returns dropped: 0 when all inputs route to a real surface", async () => {
    const emit: RecommendationEmitter = vi.fn(async (input) => mockRoute(input));
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-3",
      recommendations: [baseRec({ confidence: 0.9 })],
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(result.dropped).toBe(0);
  });

  it("humanizeRecommendation covers all action kinds with no fallback", async () => {
    const summaries: string[] = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      summaries.push(input.humanSummary);
      return mockRoute(input);
    });
    // Cover all 13 actions from AdRecommendationActionSchema. No fallback
    // path should be exercised — every action gets a custom human summary.
    const actions: RecommendationOutput["action"][] = [
      "scale",
      "pause",
      "refresh_creative",
      "restructure",
      "hold",
      "test",
      "review_budget",
      "add_creative",
      "expand_targeting",
      "consolidate",
      "shift_budget_to_source",
      "switch_optimization_event",
      "harden_capi_attribution",
    ];
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-4",
      recommendations: actions.map((a, i) =>
        baseRec({ action: a, campaignId: `c-${i}`, confidence: 0.6 }),
      ),
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(summaries).toHaveLength(actions.length);
    summaries.forEach((s) => {
      expect(s.length).toBeGreaterThan(5);
      // Sanity: must mention the campaign name (proves we humanized, not just
      // dumped the raw action label).
      expect(s).toContain("Whitening Set B");
    });
  });

  it("budget/structure actions emit financialEffect:true and externalEffect:true", async () => {
    // Safety invariant (spec §8.4 / §6): every action that writes to the ad
    // platform or changes live spend state must have financialEffect:true AND
    // externalEffect:true so that canSwipeApprove() returns false. An accidental
    // swipe must be impossible for money-moving actions.
    const financialActions: RecommendationOutput["action"][] = [
      "scale",
      "pause",
      "restructure",
      "review_budget",
      "shift_budget_to_source",
      "consolidate",
      "expand_targeting",
      "switch_optimization_event",
    ];
    for (const action of financialActions) {
      const capturedInputs: RecommendationInput[] = [];
      const emit: RecommendationEmitter = vi.fn(async (input) => {
        capturedInputs.push(input);
        return { surface: "queue" as const };
      });
      await runRecommendationSink({
        orgId: "org-risk",
        auditRunId: "audit-risk",
        recommendations: [baseRec({ action })],
        emit,
        emissionContext: { cronId: "cron-risk", deploymentId: "dep-risk" },
      });
      const emitted = capturedInputs[0]!;
      expect(emitted.financialEffect, `${action}: financialEffect must be true`).toBe(true);
      expect(emitted.externalEffect, `${action}: externalEffect must be true`).toBe(true);
    }
  });

  it("informational actions emit financialEffect:false and externalEffect:false", async () => {
    // These actions queue internal work or open external links without mutating
    // live campaign state — they are legitimately swipe-approvable.
    const informationalActions: RecommendationOutput["action"][] = [
      "hold",
      "test",
      "refresh_creative",
      "add_creative",
      "harden_capi_attribution",
      "fix_signal_health",
    ];
    for (const action of informationalActions) {
      const capturedInputs: RecommendationInput[] = [];
      const emit: RecommendationEmitter = vi.fn(async (input) => {
        capturedInputs.push(input);
        return { surface: "queue" as const };
      });
      await runRecommendationSink({
        orgId: "org-risk",
        auditRunId: "audit-risk",
        recommendations: [baseRec({ action })],
        emit,
        emissionContext: { cronId: "cron-risk", deploymentId: "dep-risk" },
      });
      const emitted = capturedInputs[0]!;
      expect(emitted.financialEffect, `${action}: financialEffect must be false`).toBe(false);
      expect(emitted.externalEffect, `${action}: externalEffect must be false`).toBe(false);
    }
  });

  it("buildPresentation emits action-specific acceptToast and declineToast for every action", async () => {
    const presentations: Array<{
      action: RecommendationOutput["action"];
      acceptToast: string | undefined;
      declineToast: string | undefined;
    }> = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      presentations.push({
        action: input.action as RecommendationOutput["action"],
        acceptToast: input.presentation.acceptToast,
        declineToast: input.presentation.declineToast,
      });
      return mockRoute(input);
    });
    const actions: RecommendationOutput["action"][] = [
      "scale",
      "pause",
      "refresh_creative",
      "restructure",
      "hold",
      "test",
      "review_budget",
      "add_creative",
      "expand_targeting",
      "consolidate",
      "shift_budget_to_source",
      "switch_optimization_event",
      "harden_capi_attribution",
      "fix_signal_health",
    ];
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-toasts",
      recommendations: actions.map((a, i) =>
        baseRec({ action: a, campaignId: `c-${i}`, confidence: 0.9 }),
      ),
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(presentations).toHaveLength(actions.length);

    // All actions must have non-empty toasts.
    for (const p of presentations) {
      expect(p.acceptToast, `${p.action} acceptToast must be non-empty`).toBeTruthy();
      expect(p.declineToast, `${p.action} declineToast must be non-empty`).toBeTruthy();
    }

    // Actions that interpolate the campaign name must contain it.
    // harden_capi_attribution and fix_signal_health reference "the pixel" /
    // "CAPI attribution" and do NOT interpolate campaign name — exclude them.
    const campaignNameActions: RecommendationOutput["action"][] = [
      "scale",
      "pause",
      "refresh_creative",
      "restructure",
      "hold",
      "test",
      "review_budget",
      "add_creative",
      "expand_targeting",
      "consolidate",
      "shift_budget_to_source",
      "switch_optimization_event",
    ];
    for (const p of presentations.filter((p) => campaignNameActions.includes(p.action))) {
      expect(p.acceptToast ?? "", `${p.action} acceptToast must contain campaign name`).toContain(
        "Whitening Set B",
      );
    }

    // Spot-check specific toast copy.
    const pause = presentations.find((p) => p.action === "pause")!;
    expect(pause.acceptToast).toBe("Paused Whitening Set B. Standing by.");
    expect(pause.declineToast).toBe("Leaving Whitening Set B running.");

    const scale = presentations.find((p) => p.action === "scale")!;
    expect(scale.acceptToast).toBe("Scaling Whitening Set B 20%.");
    expect(scale.declineToast).toBe("Holding Whitening Set B where it is.");

    const fix = presentations.find((p) => p.action === "fix_signal_health")!;
    expect(fix.acceptToast).toBe("Opening Events Manager for the pixel.");
    expect(fix.declineToast).toBe("Acknowledged — back to scanning the pixel.");
  });
});

describe("runRecommendationSink — structured spend amount", () => {
  const run = async (rec: RecommendationOutput) => {
    const emit = vi.fn(async () => ({ surface: "queue" }) as EmitOutcome);
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "run-1",
      recommendations: [rec],
      emit,
      emissionContext: { cronId: "c1" },
    });
    return (emit.mock.calls[0]![0] as RecommendationInput).parameters as Record<string, unknown>;
  };

  it("populates parameters.spendAmount from dollarsAtRisk for a financialEffect action", async () => {
    // pause is financialEffect:true; "saves $40/day" ⇒ dollarsAtRisk 40.
    const params = await run(baseRec({ action: "pause", estimatedImpact: "saves $40/day" }));
    expect(params["spendAmount"]).toBe(40);
  });

  it("omits spendAmount when no dollar figure is present (fail-safe: stays parked)", async () => {
    const params = await run(baseRec({ action: "scale", estimatedImpact: "better reach" }));
    expect(params["spendAmount"]).toBeUndefined();
  });

  it("omits spendAmount for a non-financial (informational) action", async () => {
    // hold is financialEffect:false even with a dollar figure in the impact.
    const params = await run(baseRec({ action: "hold", estimatedImpact: "~$50 at stake" }));
    expect(params["spendAmount"]).toBeUndefined();
  });
});
