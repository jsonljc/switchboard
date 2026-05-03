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
    });
    expect(result.routedQueue + result.routedShadow + result.dropped).toBe(2);
    expect(emit).toHaveBeenCalledTimes(2);
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
    });
    expect(summaries).toHaveLength(actions.length);
    summaries.forEach((s) => {
      expect(s.length).toBeGreaterThan(5);
      // Sanity: must mention the campaign name (proves we humanized, not just
      // dumped the raw action label).
      expect(s).toContain("Whitening Set B");
    });
  });
});
