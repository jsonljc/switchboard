import { describe, it, expect } from "vitest";
import {
  confidenceModifierForKind,
  applyConfidenceModifier,
  applyConfidenceModifierToRecs,
  MIN_VERDICTS_FOR_MODIFIER,
} from "./confidence-modifier.js";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";

describe("confidenceModifierForKind", () => {
  it("ABSTAINS (1.0) below the min-sample floor", () => {
    expect(confidenceModifierForKind({ approved: 1, rejected: 0 })).toBe(1.0); // 1 verdict < floor
    expect(confidenceModifierForKind({ approved: 0, rejected: 0 })).toBe(1.0);
  });

  it("nudges UP for a high approval rate over enough samples, bounded", () => {
    const m = confidenceModifierForKind({ approved: 18, rejected: 2 }); // 90% over 20
    expect(m).toBeGreaterThan(1.0);
    expect(m).toBeLessThanOrEqual(1.15); // bounded ceiling
  });

  it("nudges DOWN for a low approval rate, bounded by a floor", () => {
    const m = confidenceModifierForKind({ approved: 3, rejected: 17 }); // 15% over 20
    expect(m).toBeLessThan(1.0);
    expect(m).toBeGreaterThanOrEqual(0.85); // bounded floor
  });

  it("ABSTAINS (1.0) on non-finite counts, never a NaN modifier", () => {
    expect(confidenceModifierForKind({ approved: NaN, rejected: 5 })).toBe(1.0);
    expect(confidenceModifierForKind({ approved: 5, rejected: Infinity })).toBe(1.0);
  });
});

describe("applyConfidenceModifier", () => {
  it("scales a confidence and clamps to [0,1]", () => {
    expect(applyConfidenceModifier(0.7, 1.1)).toBeCloseTo(0.77, 5);
    expect(applyConfidenceModifier(0.95, 1.15)).toBe(1); // clamped, never > 1
    expect(applyConfidenceModifier(0.5, 1.0)).toBe(0.5); // identity on abstain
  });

  it("is identity when the modifier is the abstain value", () => {
    expect(applyConfidenceModifier(0.85, 1.0)).toBe(0.85);
  });

  it("returns the confidence unchanged on a non-finite modifier or confidence", () => {
    expect(applyConfidenceModifier(0.7, NaN)).toBe(0.7);
    expect(applyConfidenceModifier(NaN, 1.1)).toBeNaN();
  });
});

it("exports a sane floor constant", () => {
  expect(MIN_VERDICTS_FOR_MODIFIER).toBeGreaterThanOrEqual(5);
});

describe("applyConfidenceModifierToRecs", () => {
  const rec = (action: string, confidence: number): RecommendationOutput =>
    ({ type: "recommendation", action, confidence }) as unknown as RecommendationOutput;

  it("returns the SAME array unchanged when no modifier (back-compat)", () => {
    const recs = [rec("pause", 0.9)];
    expect(applyConfidenceModifierToRecs(recs, undefined)).toBe(recs); // identical reference
  });

  it("scales each rec's confidence PER kind, clamped to [0,1]", () => {
    const out = applyConfidenceModifierToRecs(
      [rec("pause", 0.9), rec("add_creative", 0.8)],
      (action) => (action === "pause" ? 1.15 : 1.1),
    );
    expect(out.find((r) => r.action === "pause")?.confidence).toBe(1); // 0.9 * 1.15 -> clamped
    expect(out.find((r) => r.action === "add_creative")?.confidence).toBeCloseTo(0.88, 5);
  });

  it("does not mutate the input recs", () => {
    const recs = [rec("pause", 0.9)];
    applyConfidenceModifierToRecs(recs, () => 1.1);
    expect(recs[0]?.confidence).toBe(0.9);
  });
});
