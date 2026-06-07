import { describe, it, expect } from "vitest";
import { deriveBusinessContextStability } from "../operational-stability.js";
import type { OperationalState, OperationalStateConfirmation } from "@switchboard/schemas";

// Same window as the shipped 4c matrix: [June 1 .. June 15), a 14-day full
// attribution window. A LATE row is a confirmation with confirmedAt strictly
// after WINDOW_END; attribution runs >= 24h after windowEnd (settlement
// lag), so late rows exist for every live candidate.
const WINDOW_START = new Date("2026-06-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-06-15T00:00:00.000Z");

/** Operator confirmed every dimension non-disruptive ([] = "confirmed none"). */
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
    id: `osc_late_${seq}`,
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

/** Fresh, complete, non-disruptive governing row: certifies stable alone. */
function governingStable(): OperationalStateConfirmation {
  return confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL);
}

describe("late-interval admission: disruption-only asymmetry (slice 4e)", () => {
  it("flips a certified-stable window to unstable on a late closure overlapping it", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-06T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flips a certified-stable window to unstable on a late promo partially overlapping it", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-06-08T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flips an ungoverned (unknown) window to unstable on a late overlapping closure", () => {
    expect(
      derive([
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-06T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flips a stale-governed (unknown) window to unstable on a late partial promo", () => {
    expect(
      derive([
        confirm("2026-04-01T09:00:00.000Z", FULL_NORMAL), // stale at window entry
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-06-08T00:00:00.000Z", end: "2026-06-10T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("never certifies from late evidence: a late full-normal confirmation on an ungoverned window stays unknown", () => {
    expect(derive([confirm("2026-06-16T09:00:00.000Z", FULL_NORMAL)])).toBe("unknown");
  });

  it("never restores freshness from late evidence: a late full-normal confirmation cannot rescue a stale governing row", () => {
    expect(
      derive([
        confirm("2026-04-01T09:00:00.000Z", FULL_NORMAL), // stale governing
        confirm("2026-06-16T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("unknown");
  });

  it("is monotone: late benign rows cannot flip an in-window-disrupted window away from unstable", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-05T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
        confirm("2026-06-16T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("unstable");
  });
});

describe("late-interval admission: intervals only, never scalar inference", () => {
  it("ignores a late scalar-only staffing shortfall: stable stays stable", () => {
    expect(
      derive([governingStable(), confirm("2026-06-16T09:00:00.000Z", { staffing: "shortfall" })]),
    ).toBe("stable");
  });

  it("ignores a late scalar-only temporarily_closed with no dated closure interval (only dated facts reach back)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", { operatingStatus: "temporarily_closed" }),
      ]),
    ).toBe("stable");
  });

  it("does not treat a late scalar flip against the governing value as a transition", () => {
    expect(
      derive([
        governingStable(), // staffing: "normal"
        confirm("2026-06-16T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("stable");
  });

  it("leaves an ungoverned window unknown under late scalar-only rows", () => {
    expect(derive([confirm("2026-06-16T09:00:00.000Z", { inventory: "outage" })])).toBe("unknown");
  });

  it("does not run the declaration-change detector over late rows: a late COVERING promo against a governing [] stays stable", () => {
    // The same dated content declared by an IN-WINDOW row trips the
    // overlappingSubsetKey change detector (pinned in the 4c matrix);
    // arriving late it is geometry-only, and a promo covering the entire
    // window is constant background that differences out.
    expect(
      derive([
        governingStable(), // promoWindows: []
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("still disrupts on a late PARTIAL promo against a governing [] (geometry, not change-detection)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-06-12T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });
});

describe("late-interval admission: boundary doctrine", () => {
  it("ignores a late closure starting exactly at windowEnd (half-open window; that instant is never measured)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-06-15T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("ignores a late closure ending exactly at windowStart (half-open interval excludes its own end)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-05-20T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("disrupts on a late closure ending exactly at windowEnd (covers measured instants)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-06-10T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("treats a late covering promo ending exactly at windowEnd as covering (stable)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("keeps a confirmation AT windowEnd an in-window row (scalar transition applies; shipped 4c bucketing)", () => {
    expect(
      derive([
        governingStable(), // staffing: "normal"
        confirm("2026-06-15T00:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("unstable");
  });

  it("treats the same scalar flip 1ms after windowEnd as a late row (no transition inference)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-15T00:00:00.001Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("stable");
  });
});

describe("late-interval admission: union, fail-safe, inertness, order", () => {
  it("does not retract: a later late [] re-confirm cannot erase a previously late-declared overlapping promo", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-06-08T00:00:00.000Z", end: "2026-06-10T00:00:00.000Z" }],
        }),
        confirm("2026-06-17T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("unstable");
  });

  it("fails toward unstable on a late interval with unparseable bounds (direct-caller guard)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "not-a-date", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("keeps benign late rows inert across all three base verdicts", () => {
    const benignLate = () =>
      confirm("2026-06-16T09:00:00.000Z", {
        staffing: "shortfall", // scalar: never read on late rows
        promoWindows: [{ start: "2026-06-20T00:00:00.000Z", end: "2026-06-25T00:00:00.000Z" }],
        closures: [{ start: "2026-05-01T00:00:00.000Z", end: "2026-05-10T00:00:00.000Z" }],
      });
    expect(derive([governingStable(), benignLate()])).toBe("stable");
    expect(derive([benignLate()])).toBe("unknown");
    expect(
      derive([
        governingStable(),
        confirm("2026-06-05T09:00:00.000Z", { ...FULL_NORMAL, inventory: "outage" }),
        benignLate(),
      ]),
    ).toBe("unstable");
  });

  it("derives the same verdict from a shuffled set including late rows (defensive sort)", () => {
    const governing = governingStable();
    const inWindow = confirm("2026-06-05T09:00:00.000Z", FULL_NORMAL);
    const late = confirm("2026-06-16T09:00:00.000Z", {
      closures: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-06T00:00:00.000Z" }],
    });
    expect(derive([late, inWindow, governing])).toBe("unstable");
    expect(derive([governing, late, inWindow])).toBe("unstable");
  });
});
