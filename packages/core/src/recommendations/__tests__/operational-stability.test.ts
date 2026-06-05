import { describe, it, expect } from "vitest";
import { deriveBusinessContextStability } from "../operational-stability.js";
import type { OperationalState, OperationalStateConfirmation } from "@switchboard/schemas";

// Window under test: [June 1 .. June 15) (a 14-day full attribution window).
const WINDOW_START = new Date("2026-06-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-06-15T00:00:00.000Z");

/** Operator confirmed every dimension non-disruptive ([] = "confirmed none" is a POSITIVE signal). */
const FULL_NORMAL: OperationalState = {
  operatingStatus: "open",
  staffing: "normal",
  inventory: "normal",
  promoWindows: [],
  closures: [],
};

let seq = 0;
function confirm(confirmedAt: string, state: OperationalState): OperationalStateConfirmation {
  seq += 1;
  return {
    id: `osc_${seq}`,
    organizationId: "org-1",
    state,
    confirmedBy: null,
    confirmedAt: new Date(confirmedAt),
    createdAt: new Date(confirmedAt),
  };
}

function derive(confirmations: OperationalStateConfirmation[]) {
  return deriveBusinessContextStability({
    confirmations,
    windowStartedAt: WINDOW_START,
    windowEndedAt: WINDOW_END,
  });
}

describe("deriveBusinessContextStability: honest absence", () => {
  it("returns unknown for an empty confirmation set (legacy orgs; never fabricated)", () => {
    expect(derive([])).toBe("unknown");
  });

  it("returns unknown when only in-window confirmations exist (the window opened ungoverned)", () => {
    expect(derive([confirm("2026-06-03T10:00:00.000Z", FULL_NORMAL)])).toBe("unknown");
  });
});

describe("deriveBusinessContextStability: affirmative stability (the governing-row-before-window case)", () => {
  it("certifies stable from a fresh, complete, non-disruptive governing row", () => {
    // Governing row 4 days before window entry, all five dimensions confirmed.
    expect(derive([confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL)])).toBe("stable");
  });

  it("certifies stable at exactly the vouch boundary (14 days at window entry)", () => {
    expect(derive([confirm("2026-05-18T00:00:00.000Z", FULL_NORMAL)])).toBe("stable");
  });

  it("degrades to unknown just past the vouch boundary (stale governing row cannot certify)", () => {
    expect(derive([confirm("2026-05-17T23:59:59.999Z", FULL_NORMAL)])).toBe("unknown");
  });

  it("treats a governing row confirmed exactly at windowStart as governing (store lte contract)", () => {
    expect(derive([confirm("2026-06-01T00:00:00.000Z", FULL_NORMAL)])).toBe("stable");
  });

  it("returns unknown when the governing row leaves a dimension unconfirmed (silence must not vouch)", () => {
    const partial: OperationalState = {
      operatingStatus: "open",
      staffing: "normal",
      inventory: "normal",
      promoWindows: [],
      // closures: ABSENT; never confirmed, distinct from [] "confirmed none"
    };
    expect(derive([confirm("2026-05-28T09:00:00.000Z", partial)])).toBe("unknown");
  });

  it("stays stable when an identical re-confirm lands mid-window (the 4b 'everything still accurate' flow is not a transition)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL),
        confirm("2026-06-05T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: mid-window regime changes (the mid-window-change case)", () => {
  it("flags a scalar flip mid-window (normal → shortfall)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL),
        confirm("2026-06-05T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("unstable");
  });

  it("flags a recovery mid-window too (shortfall → normal is also a transition)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
        confirm("2026-06-05T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("unstable");
  });

  it("flags a disrupted scalar first confirmed mid-window with no prior knowledge (onset unknowable + disruption evidence)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", { operatingStatus: "open", promoWindows: [] }),
        confirm("2026-06-05T09:00:00.000Z", { inventory: "outage" }),
      ]),
    ).toBe("unstable");
  });

  it("does NOT flag a normal value first confirmed mid-window, but cannot certify either (incomplete governing)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          operatingStatus: "open",
          promoWindows: [],
          closures: [],
          inventory: "normal",
        }),
        confirm("2026-06-05T09:00:00.000Z", { staffing: "normal" }),
      ]),
    ).toBe("unknown");
  });

  it("flags an in-window disruption even when the governing row is stale (disruption evidence does not expire)", () => {
    expect(
      derive([
        confirm("2026-04-01T09:00:00.000Z", FULL_NORMAL), // stale governing
        confirm("2026-06-05T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("unstable");
  });

  it("flags an in-window disruption with no governing row at all", () => {
    expect(
      derive([confirm("2026-06-05T09:00:00.000Z", { operatingStatus: "temporarily_closed" })]),
    ).toBe("unstable");
  });
});

describe("deriveBusinessContextStability: constant context differences out", () => {
  it("certifies stable under a CONSTANT staffing shortfall (a stably-degraded context does not confound a delta)", () => {
    expect(
      derive([confirm("2026-05-28T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" })]),
    ).toBe("stable");
  });

  it("certifies stable under a constant inventory outage", () => {
    expect(
      derive([confirm("2026-05-28T09:00:00.000Z", { ...FULL_NORMAL, inventory: "outage" })]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: closure carve-out (constancy does not rescue a closed business)", () => {
  it("flags temporarily_closed governing the window even when constant", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          operatingStatus: "temporarily_closed",
        }),
      ]),
    ).toBe("unstable");
  });

  it("flags a closure interval overlapping the window", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          closures: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-06T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flags an open-ended closure starting before the window (until further notice)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          closures: [{ start: "2026-05-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("ignores a closure interval entirely outside the window (operator-declared bounds carry their own dates)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          closures: [{ start: "2026-05-01T00:00:00.000Z", end: "2026-05-10T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("ignores a closure starting exactly at windowEnd (half-open window; that instant is never measured)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          closures: [{ start: "2026-06-15T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: promo comparability", () => {
  it("flags a promo starting mid-window (partial overlap breaks pre/post comparability)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-06-08T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flags a promo ending mid-window", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-20T00:00:00.000Z", end: "2026-06-08T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("certifies stable when a promo RUNS THROUGHOUT the entire window (constant background)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("certifies stable when a declared promo lies entirely outside the window", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-07-01T00:00:00.000Z", end: "2026-07-10T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("flags a mid-window change to the window-overlapping promo set (a covering promo appearing where none was declared)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL), // promoWindows: []; confirmed none
        confirm("2026-06-05T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("does not flag a mid-window declaration of an out-of-window promo (overlapping subset unchanged)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL),
        confirm("2026-06-05T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-07-01T00:00:00.000Z", end: "2026-07-10T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: half-open boundary edges (the measured span is [windowStart, windowEnd))", () => {
  it("ignores a promo starting exactly at windowEnd (that instant is never measured)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-06-15T00:00:00.000Z", end: "2026-06-25T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("ignores a promo ending exactly at windowStart (half-open interval excludes its own end)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-20T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("certifies stable when a covering promo ends exactly at windowEnd (covers every measured instant)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: order independence (defensive sort)", () => {
  it("derives the same verdicts from a shuffled confirmation set (sorted by confirmedAt, createdAt, id internally)", () => {
    const governing = confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL);
    const reconfirm = confirm("2026-06-05T09:00:00.000Z", FULL_NORMAL);
    const flip = confirm("2026-06-08T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" });
    // Governing row passed LAST both times: positional assumptions would
    // misidentify it and mis-walk the transitions.
    expect(derive([reconfirm, governing])).toBe("stable");
    expect(derive([flip, reconfirm, governing])).toBe("unstable");
  });

  it("selects the LATEST governing row when multiple pre-window rows arrive unsorted (the discriminating case)", () => {
    // The store contract returns at most ONE at-or-before row, so this input
    // is contract-violating by construction; the derivation must still pick
    // the regime that actually governed window entry. The May-20 closure was
    // superseded May 28, entirely before the window: it must not disrupt.
    const superseded = confirm("2026-05-20T09:00:00.000Z", {
      ...FULL_NORMAL,
      operatingStatus: "temporarily_closed",
    });
    const governing = confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL);
    // Reverse order: positional .at(-1) without the sort would pick the
    // superseded closed row and falsely report unstable.
    expect(derive([governing, superseded])).toBe("stable");
  });
});
