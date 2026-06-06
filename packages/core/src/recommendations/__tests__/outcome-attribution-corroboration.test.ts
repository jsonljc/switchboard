// ---------------------------------------------------------------------------
// Slice 4d: the corroborated arm of causalStrength, row-level pins.
//
// This file is the deliberate FLIP of the slice-3 "never emits corroborated"
// sweep (which lived in outcome-attribution.test.ts): the positive pin for
// when corroborated IS emitted, the strengthened no-fabrication sweep for
// when it must NOT be, the unstable-context block, and the
// directional-twin byte-identity guarantee. Split into its own file to
// respect the 600-line lint ceiling on the main attribution test file.
// Predicate-level boundary pins (floors, band, tolerance, reasons) live in
// outcome-corroboration.test.ts.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { attributeOneRecommendation } from "../outcome-attribution.js";
import type { AttributableRecommendation, WindowMetrics } from "../outcome-attribution-types.js";
import type { OperationalState, OperationalStateConfirmation } from "@switchboard/schemas";

const REC: AttributableRecommendation = {
  id: "rec-1",
  organizationId: "org-1",
  campaignId: "camp-A",
  actionKind: "pause",
  resolvedAt: new Date("2026-05-01T12:00:00Z"),
};

function w(
  spendCents: number,
  ctr: number,
  dailyRowCount = 7,
  accountSpendCents?: number,
): WindowMetrics {
  return {
    spendCents,
    ctr,
    dailyRowCount,
    ...(accountSpendCents !== undefined ? { accountSpendCents } : {}),
  };
}

const OS_FULL_NORMAL: OperationalState = {
  operatingStatus: "open",
  staffing: "normal",
  inventory: "normal",
  promoWindows: [],
  closures: [],
};

let osSeq = 0;
function osConfirm(confirmedAt: string, state: OperationalState): OperationalStateConfirmation {
  osSeq += 1;
  return {
    id: `osc_4d_${osSeq}`,
    organizationId: "org-1",
    state,
    confirmedBy: null,
    confirmedAt: new Date(confirmedAt),
    createdAt: new Date(confirmedAt),
  };
}

describe("attributeOneRecommendation: slice-4d corroborated arm", () => {
  it("emits corroborated only for a favorable pause whose booking-side estimate is judgeable and agrees", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02, 7, 100000),
      postWindow: w(800, 0.02, 7, 80000),
      overlaps: [],
      orgBookedStats: {
        preWindow: { bookedValueCents: 50000, bookedCount: 5 },
        postWindow: { bookedValueCents: 45000, bookedCount: 5 },
      },
    });
    expect(row.causalStrength).toBe("corroborated");
    // The corroborated row is otherwise its directional twin: renderability,
    // copy, and the trust signal are untouched by the upgrade.
    expect(row.cockpitRenderable).toBe(true);
    expect(row.copyTemplate).toBe("pause.spend.fell");
    expect(row.trustDelta).toBe("up");
  });

  it("never fabricates corroborated when the booking side is absent or unjudgeable (the slice-3 sweep, strengthened)", () => {
    const judgeableBookings = {
      preWindow: { bookedValueCents: 50000, bookedCount: 5 },
      postWindow: { bookedValueCents: 45000, bookedCount: 5 },
    };
    const fixtures: Array<{
      name: string;
      input: Parameters<typeof attributeOneRecommendation>[0];
    }> = [
      {
        name: "no reader wired (today's callers, byte-identical)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [],
        },
      },
      {
        name: "reader wired but account spend missing (provider cannot supply)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02),
          postWindow: w(800, 0.02),
          overlaps: [],
          orgBookedStats: judgeableBookings,
        },
      },
      {
        name: "sparse bookings (2 < 3 in the post window)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [],
          orgBookedStats: {
            preWindow: { bookedValueCents: 50000, bookedCount: 5 },
            postWindow: { bookedValueCents: 45000, bookedCount: 2 },
          },
        },
      },
      {
        name: "zero-booking post window (the spec's literal no-fabrication case)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [],
          orgBookedStats: {
            preWindow: { bookedValueCents: 50000, bookedCount: 5 },
            postWindow: { bookedValueCents: 0, bookedCount: 0 },
          },
        },
      },
      {
        name: "account spend collapsed past continuity (single-campaign degeneracy)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 10000),
          postWindow: w(800, 0.02, 7, 800),
          overlaps: [],
          orgBookedStats: judgeableBookings,
        },
      },
      {
        name: "booking efficiency degraded past the hold tolerance (the second estimate DISAGREES)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [],
          orgBookedStats: {
            preWindow: { bookedValueCents: 50000, bookedCount: 5 },
            postWindow: { bookedValueCents: 10000, bookedCount: 5 },
          },
        },
      },
      {
        name: "unfavorable pause (spend rose: nothing to corroborate)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(11000, 0.02, 7, 110000),
          overlaps: [],
          orgBookedStats: judgeableBookings,
        },
      },
      {
        name: "flagged row (overlap): no clean first estimate",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [{ id: "rec-2", actionKind: "pause" as const }],
          orgBookedStats: judgeableBookings,
        },
      },
      {
        name: "refresh_creative with passing inputs (recorded per-kind deferral)",
        input: {
          candidate: { ...REC, actionKind: "refresh_creative" as const },
          preWindow: w(50000, 0.02, 14, 100000),
          postWindow: w(50000, 0.024, 14, 100000),
          overlaps: [],
          orgBookedStats: judgeableBookings,
        },
      },
    ];
    for (const { name, input } of fixtures) {
      const row = attributeOneRecommendation(input);
      expect(["directional", "inconclusive"], name).toContain(row.causalStrength);
    }
  });

  it("never corroborates over an operator-confirmed unstable window (both estimates confounded)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02, 7, 100000),
      postWindow: w(800, 0.02, 7, 80000),
      overlaps: [],
      operationalStateConfirmations: [
        osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL),
        osConfirm("2026-05-02T09:00:00.000Z", { ...OS_FULL_NORMAL, staffing: "shortfall" }),
      ],
      orgBookedStats: {
        preWindow: { bookedValueCents: 50000, bookedCount: 5 },
        postWindow: { bookedValueCents: 45000, bookedCount: 5 },
      },
    });
    expect(row.businessContextStable).toBe("unstable");
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("none");
  });

  it("keeps the corroborated row byte-identical to its directional twin everywhere but causalStrength", () => {
    const base = {
      candidate: REC,
      preWindow: w(10000, 0.02, 7, 100000),
      postWindow: w(800, 0.02, 7, 80000),
      overlaps: [],
    };
    const directionalTwin = attributeOneRecommendation(base);
    const corroborated = attributeOneRecommendation({
      ...base,
      orgBookedStats: {
        preWindow: { bookedValueCents: 50000, bookedCount: 5 },
        postWindow: { bookedValueCents: 45000, bookedCount: 5 },
      },
    });
    expect(directionalTwin.causalStrength).toBe("directional");
    expect(corroborated.causalStrength).toBe("corroborated");
    expect({ ...corroborated, causalStrength: "x" }).toEqual({
      ...directionalTwin,
      causalStrength: "x",
    });
  });
});
