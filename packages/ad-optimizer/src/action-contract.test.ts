import { describe, it, expect, vi } from "vitest";
import {
  ACTION_CONTRACT,
  isMutating,
  isPhaseCActionClassEligible,
  PHASE_C_EXECUTION_SEAM,
  type ActionContract,
} from "./action-contract.js";
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

describe("PHASE_C_EXECUTION_SEAM (designed-but-unwired; Riley v3 slice 5)", () => {
  it("contains exactly the pause entry (each class earns its entry when it earns execution)", () => {
    expect(Object.keys(PHASE_C_EXECUTION_SEAM)).toEqual(["pause"]);
  });

  it("pause is platform-state reversible with a resume rollback and non-empty execution metadata", () => {
    const pause = PHASE_C_EXECUTION_SEAM.pause!;
    expect(pause.reversibility).toBe("full");
    expect(pause.rollbackPlan).toMatch(/resume/i);
    expect(pause.rollbackPlan).toMatch(/not .*lost delivery|platform state/i);
    expect(pause.successMetric.length).toBeGreaterThan(0);
    expect(pause.guardrailMetrics.length).toBeGreaterThan(0);
  });

  it("the seam is a SIBLING of the live contract, not a mutation of it", () => {
    // live record untouched: still exactly the 14 actions, and the seam entry is a
    // different object with a different shape from the live pause row
    expect(Object.keys(ACTION_CONTRACT).sort()).toEqual([...ALL_ACTIONS].sort());
    expect(PHASE_C_EXECUTION_SEAM.pause).not.toBe(ACTION_CONTRACT.pause);
    expect(ACTION_CONTRACT.pause).not.toHaveProperty("reversibility");
  });

  it("pause keeps its destructive evidence family (the mapper's floor cannot silently weaken)", () => {
    expect(evidenceFamilyFor("pause")).toBe("destructive");
  });

  it("isPhaseCActionClassEligible admits pause and nothing else", () => {
    for (const action of ALL_ACTIONS) {
      expect(isPhaseCActionClassEligible(action), action).toBe(action === "pause");
    }
  });

  it("class eligibility is the conjunction the wiring session flips on: seam + reversible + no-reset + mutating", () => {
    // pause satisfies all four legs today; if any leg drifts, eligibility must collapse to false
    expect(PHASE_C_EXECUTION_SEAM.pause?.reversibility).toBe("full");
    expect(ACTION_CONTRACT.pause.resetsLearning).toBe("no");
    expect(isMutating("pause")).toBe(true);
  });
});
