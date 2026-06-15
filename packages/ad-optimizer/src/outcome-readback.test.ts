import { describe, it, expect } from "vitest";
import { outcomeAdjustmentForKind, MIN_OUTCOMES_FOR_READBACK } from "./outcome-readback.js";

describe("outcomeAdjustmentForKind", () => {
  it("ABSTAINS (neutral) below the min corroborated-direction floor", () => {
    expect(outcomeAdjustmentForKind({ corroboratedUp: 1, corroboratedDown: 0 })).toEqual({
      confidenceMultiplier: 1.0,
      abstained: true,
    });
  });

  it("ABSTAINS when no corroborated row carries a direction (directional-only never counts here)", () => {
    // The store only feeds corroborated-direction counts, so a directional-only history arrives as
    // {0,0} -> directioned 0 < floor -> abstain.
    const adj = outcomeAdjustmentForKind({ corroboratedUp: 0, corroboratedDown: 0 });
    expect(adj.abstained).toBe(true);
    expect(adj.confidenceMultiplier).toBe(1.0);
  });

  it("nudges UP, bounded, when corroborated outcomes trend favorable", () => {
    const adj = outcomeAdjustmentForKind({ corroboratedUp: 8, corroboratedDown: 1 });
    expect(adj.confidenceMultiplier).toBeGreaterThan(1.0);
    expect(adj.confidenceMultiplier).toBeLessThanOrEqual(1.1); // tighter than approval-rate
    expect(adj.abstained).toBe(false);
  });

  it("nudges DOWN, bounded, when corroborated outcomes trend unfavorable", () => {
    const adj = outcomeAdjustmentForKind({ corroboratedUp: 1, corroboratedDown: 8 });
    expect(adj.confidenceMultiplier).toBeLessThan(1.0);
    expect(adj.confidenceMultiplier).toBeGreaterThanOrEqual(0.9);
    expect(adj.abstained).toBe(false);
  });

  it("ABSTAINS on non-finite inputs, never NaN", () => {
    expect(outcomeAdjustmentForKind({ corroboratedUp: NaN, corroboratedDown: 1 })).toEqual({
      confidenceMultiplier: 1.0,
      abstained: true,
    });
    expect(outcomeAdjustmentForKind({ corroboratedUp: 5, corroboratedDown: Infinity })).toEqual({
      confidenceMultiplier: 1.0,
      abstained: true,
    });
  });
});

it("min-outcome floor is at least the corroboration min-bookings discipline", () => {
  expect(MIN_OUTCOMES_FOR_READBACK).toBeGreaterThanOrEqual(3);
});
