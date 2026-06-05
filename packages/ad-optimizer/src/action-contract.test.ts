import { describe, it, expect, vi } from "vitest";
import { ACTION_CONTRACT, isMutating, type ActionContract } from "./action-contract.js";
import { ACTION_RESETS_LEARNING, resetsLearningFor } from "./action-reset-classification.js";
import { evidenceFamilyFor } from "./evidence-floor.js";
import { runRecommendationSink } from "./recommendation-sink.js";
import type {
  RecommendationOutputSchema as RecommendationOutput,
  RecommendationInput,
} from "@switchboard/schemas";

const ALL_ACTIONS = Object.keys(ACTION_CONTRACT) as RecommendationOutput["action"][];

function makeRec(action: RecommendationOutput["action"]): RecommendationOutput {
  return {
    type: "recommendation",
    action,
    campaignId: "c1",
    campaignName: "C1",
    confidence: 0.8,
    urgency: "this_week",
    estimatedImpact: "test impact",
    steps: ["step"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
  };
}

describe("ACTION_CONTRACT consolidation", () => {
  it("covers exactly the 14 actions", () => {
    expect(ALL_ACTIONS.sort()).toEqual(
      [
        "scale",
        "pause",
        "restructure",
        "review_budget",
        "shift_budget_to_source",
        "consolidate",
        "expand_targeting",
        "switch_optimization_event",
        "hold",
        "test",
        "refresh_creative",
        "add_creative",
        "harden_capi_attribution",
        "fix_signal_health",
      ].sort(),
    );
  });

  it("agrees with the legacy reset classification for every action", () => {
    for (const action of ALL_ACTIONS) {
      expect(ACTION_CONTRACT[action].resetsLearning).toBe(ACTION_RESETS_LEARNING[action]);
      expect(ACTION_CONTRACT[action].resetsLearning).toBe(resetsLearningFor(action));
    }
  });

  it("agrees with the legacy evidence-family classification for every action", () => {
    for (const action of ALL_ACTIONS) {
      expect(ACTION_CONTRACT[action].evidenceFamily).toBe(evidenceFamilyFor(action));
    }
  });

  it("isMutating bakes in the elevation: both static-false-but-elevated cases are mutating", () => {
    // refresh_creative AND add_creative are {financialEffect:false, externalEffect:false}
    // in the static contract but resetsLearning="yes"; the sink elevates them.
    expect(ACTION_CONTRACT.refresh_creative.financialEffect).toBe(false);
    expect(ACTION_CONTRACT.refresh_creative.externalEffect).toBe(false);
    expect(isMutating("refresh_creative")).toBe(true);
    expect(ACTION_CONTRACT.add_creative.financialEffect).toBe(false);
    expect(ACTION_CONTRACT.add_creative.externalEffect).toBe(false);
    expect(isMutating("add_creative")).toBe(true);
    // pause is static true/true with resetsLearning="no": mutating via the booleans.
    expect(isMutating("pause")).toBe(true);
    // The four informational actions stay non-mutating.
    expect(isMutating("hold")).toBe(false);
    expect(isMutating("test")).toBe(false);
    expect(isMutating("harden_capi_attribution")).toBe(false);
    expect(isMutating("fix_signal_health")).toBe(false);
  });

  it("isMutating agrees with the REAL sink's emitted booleans for all 14 actions", async () => {
    const emitted: RecommendationInput[] = [];
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit:test",
      recommendations: ALL_ACTIONS.map(makeRec),
      emit: vi.fn(async (input: RecommendationInput) => {
        emitted.push(input);
        return { surface: "queue" as const };
      }),
      emissionContext: { cronId: "cron-test" },
    });
    expect(emitted).toHaveLength(ALL_ACTIONS.length);
    for (const input of emitted) {
      const action = input.action as RecommendationOutput["action"];
      const c = ACTION_CONTRACT[action];
      // The sink's emitted booleans derive from the SAME record (financial verbatim,
      // external elevated by resetsLearning).
      expect(input.financialEffect).toBe(c.financialEffect);
      expect(input.externalEffect).toBe(c.externalEffect || c.resetsLearning === "yes");
      // isMutating is exactly "the sink would emit a financial or (elevated) external effect".
      expect(isMutating(action)).toBe(
        Boolean(input.financialEffect) || Boolean(input.externalEffect),
      );
    }
  });

  it("exposes the contract type", () => {
    const c: ActionContract = ACTION_CONTRACT.scale;
    expect(c.financialEffect).toBe(true);
  });
});
