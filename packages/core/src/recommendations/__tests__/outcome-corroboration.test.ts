import { describe, it, expect } from "vitest";
import {
  CORROBORATION_MIN_BOOKINGS_PER_WINDOW,
  CORROBORATION_RATIO_HOLD_TOLERANCE,
  CORROBORATION_SPEND_CONTINUITY_CEILING,
  CORROBORATION_SPEND_CONTINUITY_FLOOR,
  deriveCorroboration,
  type DeriveCorroborationInput,
} from "../outcome-corroboration.js";

/**
 * Baseline passing input (every test perturbs exactly one dimension):
 * pause, clean favorable delta, context unknown, account spend 100000c pre /
 * 80000c post (continuity 0.8, inside [0.5, 1.5]), bookings 5/5, booked
 * value 50000c pre (ratio 0.5) / 45000c post (ratio 0.5625 >= 0.8 * 0.5 = 0.4).
 */
function passing(): DeriveCorroborationInput {
  return {
    actionKind: "pause",
    visibilityFlagCount: 0,
    deltaPct: -92,
    businessContextStable: "unknown",
    preAccountSpendCents: 100000,
    postAccountSpendCents: 80000,
    orgBookedStats: {
      preWindow: { bookedValueCents: 50000, bookedCount: 5 },
      postWindow: { bookedValueCents: 45000, bookedCount: 5 },
    },
  };
}

const CORROBORATED = { causalStrengthUpgrade: "corroborated", reason: "corroborated" } as const;

function rejected(reason: string): { causalStrengthUpgrade: null; reason: string } {
  return { causalStrengthUpgrade: null, reason };
}

describe("deriveCorroboration: constants", () => {
  it("pins the floors, band, and tolerance (spec 4d section 2)", () => {
    expect(CORROBORATION_MIN_BOOKINGS_PER_WINDOW).toBe(3);
    expect(CORROBORATION_SPEND_CONTINUITY_FLOOR).toBe(0.5);
    expect(CORROBORATION_SPEND_CONTINUITY_CEILING).toBe(1.5);
    expect(CORROBORATION_RATIO_HOLD_TOLERANCE).toBe(0.8);
  });
});

describe("deriveCorroboration: the passing case and the agreement boundary", () => {
  it("corroborates the baseline (favorable pause, floors met, ratio held)", () => {
    expect(deriveCorroboration(passing())).toEqual(CORROBORATED);
  });

  it("corroborates when booking efficiency IMPROVED (the expected waste-pause outcome)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow.bookedValueCents = 90000;
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("corroborates at exactly the hold boundary (post ratio = 0.8 x pre ratio)", () => {
    const input = passing();
    // pre ratio 0.5; threshold 0.4; post spend 80000 => booked exactly 32000.
    input.orgBookedStats!.postWindow.bookedValueCents = 32000;
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("degrades just below the hold boundary (the second estimate does not agree)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow.bookedValueCents = 31999;
    expect(deriveCorroboration(input)).toEqual(rejected("ratio_degraded"));
  });
});

describe("deriveCorroboration: preconditions (P1-P4)", () => {
  it("never corroborates refresh_creative, even with passing inputs (recorded deferral, spec 4d section 6)", () => {
    expect(deriveCorroboration({ ...passing(), actionKind: "refresh_creative" })).toEqual(
      rejected("not_pause"),
    );
  });

  it("never corroborates a flagged row (no clean first estimate)", () => {
    expect(deriveCorroboration({ ...passing(), visibilityFlagCount: 1 })).toEqual(
      rejected("visibility_flagged"),
    );
  });

  it("never corroborates without a computed delta", () => {
    expect(deriveCorroboration({ ...passing(), deltaPct: null })).toEqual(
      rejected("missing_delta"),
    );
  });

  it("never corroborates an unfavorable pause (spend rose: nothing to corroborate)", () => {
    expect(deriveCorroboration({ ...passing(), deltaPct: 10 })).toEqual(
      rejected("unfavorable_direction"),
    );
  });

  it("never corroborates a zero delta (not favorable)", () => {
    expect(deriveCorroboration({ ...passing(), deltaPct: 0 })).toEqual(
      rejected("unfavorable_direction"),
    );
  });

  it("never corroborates over an operator-confirmed unstable window (both estimates confounded)", () => {
    expect(deriveCorroboration({ ...passing(), businessContextStable: "unstable" })).toEqual(
      rejected("unstable_context"),
    );
  });

  it("corroborates over a stable window (operator confirmation strengthens, never blocks)", () => {
    expect(deriveCorroboration({ ...passing(), businessContextStable: "stable" })).toEqual(
      CORROBORATED,
    );
  });
});

describe("deriveCorroboration: judgeability floors (F1-F3, the no-fabrication set)", () => {
  it("unjudgeable when the booking reader was absent (F1)", () => {
    expect(deriveCorroboration({ ...passing(), orgBookedStats: undefined })).toEqual(
      rejected("missing_booking_stats"),
    );
  });

  it("unjudgeable when pre-window account spend is missing (F1)", () => {
    expect(deriveCorroboration({ ...passing(), preAccountSpendCents: undefined })).toEqual(
      rejected("missing_account_spend"),
    );
  });

  it("unjudgeable when post-window account spend is missing (F1)", () => {
    expect(deriveCorroboration({ ...passing(), postAccountSpendCents: undefined })).toEqual(
      rejected("missing_account_spend"),
    );
  });

  it("unjudgeable from a 0-booking window (the spec's literal floor)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow = { bookedValueCents: 0, bookedCount: 0 };
    expect(deriveCorroboration(input)).toEqual(rejected("sparse_bookings"));
  });

  it("unjudgeable below the booking floor in the PRE window (2 < 3)", () => {
    const input = passing();
    input.orgBookedStats!.preWindow.bookedCount = 2;
    expect(deriveCorroboration(input)).toEqual(rejected("sparse_bookings"));
  });

  it("unjudgeable below the booking floor in the POST window (2 < 3)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow.bookedCount = 2;
    expect(deriveCorroboration(input)).toEqual(rejected("sparse_bookings"));
  });

  it("judgeable at exactly the booking floor (3 per window)", () => {
    const input = passing();
    input.orgBookedStats!.preWindow.bookedCount = 3;
    input.orgBookedStats!.postWindow.bookedCount = 3;
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("unjudgeable with zero pre-window account spend (no ratio exists)", () => {
    expect(deriveCorroboration({ ...passing(), preAccountSpendCents: 0 })).toEqual(
      rejected("spend_continuity_failed"),
    );
  });

  it("unjudgeable when account spend collapsed past the continuity floor (the 4c degeneracy, F3)", () => {
    // Single-campaign org: post account spend ~ post campaign spend ~ 0.
    expect(deriveCorroboration({ ...passing(), postAccountSpendCents: 800 })).toEqual(
      rejected("spend_continuity_failed"),
    );
  });

  it("judgeable at exactly the continuity floor (post = 0.5 x pre)", () => {
    const input = passing();
    input.postAccountSpendCents = 50000;
    // Keep the ratio held: pre ratio 0.5, threshold 0.4; post 50000c spend
    // needs >= 20000c booked; baseline post booked 45000c passes.
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("unjudgeable just below the continuity floor", () => {
    expect(deriveCorroboration({ ...passing(), postAccountSpendCents: 49999 })).toEqual(
      rejected("spend_continuity_failed"),
    );
  });

  it("judgeable at exactly the continuity ceiling (post = 1.5 x pre)", () => {
    const input = passing();
    input.postAccountSpendCents = 150000;
    // Ratio must still hold at the bigger denominator: threshold 0.4 of pre
    // ratio 0.5 needs >= 60000c booked on 150000c post spend.
    input.orgBookedStats!.postWindow.bookedValueCents = 60000;
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("unjudgeable just above the continuity ceiling (a scaled-up account is a different regime)", () => {
    expect(deriveCorroboration({ ...passing(), postAccountSpendCents: 150001 })).toEqual(
      rejected("spend_continuity_failed"),
    );
  });
});

describe("deriveCorroboration: non-finite inputs never fabricate (NaN is comparison-blind)", () => {
  // Every reject gate is a numeric comparison, and every comparison with NaN
  // is false: without an explicit finite guard, a single malformed upstream
  // value (Meta returns spend as strings; parseFloat("N/A") is NaN) would
  // sail past every floor to a fabricated "corroborated". Review-caught.
  it("rejects NaN pre-window account spend", () => {
    expect(deriveCorroboration({ ...passing(), preAccountSpendCents: NaN })).toEqual(
      rejected("non_finite_input"),
    );
  });

  it("rejects NaN post-window account spend", () => {
    expect(deriveCorroboration({ ...passing(), postAccountSpendCents: NaN })).toEqual(
      rejected("non_finite_input"),
    );
  });

  it("rejects a NaN delta (a poisoned campaign spend must not reach the agreement test)", () => {
    expect(deriveCorroboration({ ...passing(), deltaPct: NaN })).toEqual(
      rejected("non_finite_input"),
    );
  });

  it("rejects NaN booked value", () => {
    const input = passing();
    input.orgBookedStats!.postWindow.bookedValueCents = NaN;
    expect(deriveCorroboration(input)).toEqual(rejected("non_finite_input"));
  });

  it("rejects Infinity account spend (degenerate, not judgeable)", () => {
    expect(
      deriveCorroboration({ ...passing(), postAccountSpendCents: Number.POSITIVE_INFINITY }),
    ).toEqual(rejected("non_finite_input"));
  });

  it("rejects NaN booked count", () => {
    const input = passing();
    input.orgBookedStats!.preWindow.bookedCount = NaN;
    expect(deriveCorroboration(input)).toEqual(rejected("non_finite_input"));
  });
});

describe("deriveCorroboration: explicit ratio guards (defensive; unreachable from the live reader)", () => {
  it("unjudgeable when pre-window booked value is non-positive (preRatio > 0 must not depend on a store predicate)", () => {
    const input = passing();
    // bookedCount stays 5: only schema/store drift could produce this shape.
    input.orgBookedStats!.preWindow.bookedValueCents = 0;
    expect(deriveCorroboration(input)).toEqual(rejected("invalid_booked_value"));
  });

  it("unjudgeable when post-window booked value is negative (corrupt data must not certify)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow.bookedValueCents = -100;
    expect(deriveCorroboration(input)).toEqual(rejected("invalid_booked_value"));
  });
});

describe("deriveCorroboration: cents discipline", () => {
  it("compares cents over cents (a dollars-vs-cents mixup on one side would flip the verdict)", () => {
    const input = passing();
    // If post booked value were misread as dollars (45000 -> 450), the ratio
    // would collapse 100x and the verdict would flip. Pin the true cents
    // reading and the flipped misreading.
    expect(deriveCorroboration(input).causalStrengthUpgrade).toBe("corroborated");
    input.orgBookedStats!.postWindow.bookedValueCents = 450;
    expect(deriveCorroboration(input)).toEqual(rejected("ratio_degraded"));
  });
});
