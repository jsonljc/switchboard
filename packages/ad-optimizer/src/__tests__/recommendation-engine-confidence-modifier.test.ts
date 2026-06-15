// Engine-application tests for the D7-2 approval-rate confidence modifier. The pure
// modifier math is covered in confidence-modifier.test.ts; this proves the engine
// applies a provided modifier ONCE per rec, per action kind, and that omitting it is a
// no-op (back-compat). Split into its own file to keep recommendation-engine.test.ts
// under the line cap (mirrors the #1000 split precedent).
import { describe, it, expect } from "vitest";
import { generateRecommendations } from "../recommendation-engine.js";
import type { RecommendationInput } from "../recommendation-engine.js";
import type {
  MetricDeltaSchema as MetricDelta,
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
} from "@switchboard/schemas";

function cpaDelta(current: number): MetricDelta {
  return {
    metric: "cpa",
    current,
    previous: 100,
    deltaPercent: 0,
    direction: "up",
    significant: true,
  };
}

function recs(result: (RecommendationOutput | WatchOutput)[]): RecommendationOutput[] {
  return result.filter((r): r is RecommendationOutput => r.type === "recommendation");
}

/** A durable daily breach at 3.5x target → the engine emits BOTH add_creative (0.8)
 * and pause (0.9), so a per-kind modifier can be observed on two kinds at once. */
function durableBreachInput(
  confidenceModifierByKind?: RecommendationInput["confidenceModifierByKind"],
): RecommendationInput {
  return {
    campaignId: "camp-1",
    campaignName: "Breaching Campaign",
    diagnoses: [],
    deltas: [cpaDelta(350)],
    targetCPA: 100,
    targetROAS: 3,
    currentSpend: 5000,
    targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
    evidence: { clicks: 1000, conversions: 100, days: 7 },
    ...(confidenceModifierByKind ? { confidenceModifierByKind } : {}),
  };
}

function confidenceOf(result: (RecommendationOutput | WatchOutput)[], action: string): number {
  const rec = recs(result).find((r) => r.action === action);
  if (!rec) throw new Error(`expected a ${action} rec`);
  return rec.confidence;
}

describe("generateRecommendations — confidenceModifierByKind (D7-2)", () => {
  it("is a NO-OP when no modifier is supplied (back-compat: base constants stand)", () => {
    const out = durableBreachInput();
    expect(generateRecommendations(out).length).toBeGreaterThan(0);
    expect(confidenceOf(generateRecommendations(out), "add_creative")).toBe(0.8);
    expect(confidenceOf(generateRecommendations(out), "pause")).toBe(0.9);
  });

  it("is a NO-OP when the modifier abstains (1.0)", () => {
    const out = generateRecommendations(durableBreachInput(() => 1.0));
    expect(confidenceOf(out, "add_creative")).toBe(0.8);
    expect(confidenceOf(out, "pause")).toBe(0.9);
  });

  it("scales every rec's confidence by a uniform modifier", () => {
    const out = generateRecommendations(durableBreachInput(() => 1.1));
    expect(confidenceOf(out, "add_creative")).toBeCloseTo(0.88, 5); // 0.8 * 1.1
    expect(confidenceOf(out, "pause")).toBeCloseTo(0.99, 5); // 0.9 * 1.1
  });

  it("applies the modifier PER action kind (a low pause prior must not touch add_creative)", () => {
    const out = generateRecommendations(
      durableBreachInput((action) => (action === "pause" ? 0.85 : 1.0)),
    );
    expect(confidenceOf(out, "pause")).toBeCloseTo(0.765, 5); // 0.9 * 0.85
    expect(confidenceOf(out, "add_creative")).toBe(0.8); // untouched
  });

  it("clamps the scaled confidence to [0,1] (a high prior cannot exceed 1)", () => {
    const out = generateRecommendations(
      durableBreachInput((action) => (action === "pause" ? 1.15 : 1.0)),
    );
    expect(confidenceOf(out, "pause")).toBe(1); // 0.9 * 1.15 = 1.035 -> clamped
  });
});
