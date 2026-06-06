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
import { describe, it, expect, vi } from "vitest";
import { attributeOneRecommendation, runRileyOutcomeAttribution } from "../outcome-attribution.js";
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  MetaInsightsProvider,
  OrgBookedWindowStats,
  RecommendationOutcomeStore,
  RileyOutcomeRow,
  WindowMetrics,
} from "../outcome-attribution-types.js";
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

  it("persists accountSpendCents inside the metricSummary windows verbatim (the corroboration denominator stays auditable on the row)", () => {
    // DOCUMENTED CONTRACT CHANGE (review-surfaced): once the live adapter
    // populates WindowMetrics.accountSpendCents, every row's persisted
    // metricSummary carries it, for ALL kinds, corroborated or not. That is
    // deliberate: the row preserves the exact denominator evidence its
    // causal-strength verdict was judged against. No read model exposes
    // metricSummary, so no consumer narrows on its shape.
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02, 7, 100000),
      postWindow: w(800, 0.02, 7, 80000),
      overlaps: [],
    });
    expect(row.metricSummary.preWindow?.accountSpendCents).toBe(100000);
    expect(row.metricSummary.postWindow?.accountSpendCents).toBe(80000);
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

describe("runRileyOutcomeAttribution: org-booked-stats reader threading (slice 4d)", () => {
  function makeDeps(candidates: AttributableRecommendation[]) {
    const inserted: RileyOutcomeRow[] = [];
    const recommendationStore: AttributableRecommendationStore = {
      findAttributableCandidates: vi.fn().mockResolvedValue(candidates),
      findOverlapsForCampaign: vi.fn().mockResolvedValue([]),
    };
    const outcomeStore: RecommendationOutcomeStore = {
      insert: vi.fn(async (row: RileyOutcomeRow) => {
        inserted.push(row);
      }),
      existsByRecommendationId: vi.fn().mockResolvedValue(false),
    };
    const insightsProvider: MetaInsightsProvider = {
      getWindowMetrics: vi
        .fn()
        .mockResolvedValueOnce(w(10000, 0.02, 7, 100000))
        .mockResolvedValueOnce(w(800, 0.02, 7, 80000)),
    };
    return { recommendationStore, outcomeStore, insightsProvider, inserted };
  }

  function makeReader(stats: OrgBookedWindowStats) {
    return {
      getBookedStatsForOrgWindow: vi.fn(
        async (_args: { organizationId: string; startInclusive: Date; endExclusive: Date }) =>
          stats,
      ),
    };
  }

  it("queries the reader with the EXACT Meta sub-window instants for a pause candidate and threads a corroborated verdict", async () => {
    const { recommendationStore, outcomeStore, insightsProvider, inserted } = makeDeps([REC]);
    const reader = makeReader({ bookedValueCents: 50000, bookedCount: 5 });

    const summary = await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgBookedStatsReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    // REC (pause, windowDays 7, resolvedAt 2026-05-01T12:00Z):
    // pre [2026-04-24T12:00Z, 2026-05-01T12:00Z), post [2026-05-01T12:00Z, 2026-05-08T12:00Z).
    expect(reader.getBookedStatsForOrgWindow).toHaveBeenCalledTimes(2);
    expect(reader.getBookedStatsForOrgWindow).toHaveBeenNthCalledWith(1, {
      organizationId: "org-1",
      startInclusive: new Date("2026-04-24T12:00:00Z"),
      endExclusive: new Date("2026-05-01T12:00:00Z"),
    });
    expect(reader.getBookedStatsForOrgWindow).toHaveBeenNthCalledWith(2, {
      organizationId: "org-1",
      startInclusive: new Date("2026-05-01T12:00:00Z"),
      endExclusive: new Date("2026-05-08T12:00:00Z"),
    });
    // The two reads PARTITION at the anchor (pre.endExclusive ===
    // post.startInclusive): with the store's half-open gte/lt predicate an
    // instant-of-anchor booking lands in exactly the post window, and an
    // instant-of-postEnd booking in neither. No double-count, no gap.
    const calls = reader.getBookedStatsForOrgWindow.mock.calls;
    expect(calls[0]?.[0]?.endExclusive).toEqual(calls[1]?.[0]?.startInclusive);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.causalStrength).toBe("corroborated");
    expect(summary.corroborated).toBe(1);
  });

  it("does not query the reader for refresh_creative candidates (pause-only arm)", async () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const { recommendationStore, outcomeStore, insightsProvider } = makeDeps([refreshRec]);
    const reader = makeReader({ bookedValueCents: 50000, bookedCount: 5 });

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgBookedStatsReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-20T12:00:00Z"),
    });

    expect(reader.getBookedStatsForOrgWindow).not.toHaveBeenCalled();
  });

  it("records directional with no reader wired (back-compat byte-identity) and counts zero corroborated", async () => {
    const { recommendationStore, outcomeStore, insightsProvider, inserted } = makeDeps([REC]);

    const summary = await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.causalStrength).toBe("directional");
    expect(summary.corroborated).toBe(0);
  });

  it("propagates reader failures so Inngest retries (insert-once rows must not freeze an earnable corroboration)", async () => {
    const { recommendationStore, outcomeStore, insightsProvider } = makeDeps([REC]);
    const reader = {
      getBookedStatsForOrgWindow: vi.fn(
        async (_args: { organizationId: string; startInclusive: Date; endExclusive: Date }) => {
          throw new Error("db blip");
        },
      ),
    };

    await expect(
      runRileyOutcomeAttribution({
        recommendationStore,
        insightsProvider,
        outcomeStore,
        orgBookedStatsReader: reader,
        orgId: "org-1",
        now: new Date("2026-05-10T12:00:00Z"),
      }),
    ).rejects.toThrow("db blip");
    expect(outcomeStore.insert).not.toHaveBeenCalled();
  });

  it("does not query the reader for candidates skipped by the idempotency pre-check", async () => {
    const { recommendationStore, outcomeStore, insightsProvider } = makeDeps([REC]);
    (outcomeStore.existsByRecommendationId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const reader = makeReader({ bookedValueCents: 50000, bookedCount: 5 });

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgBookedStatsReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    expect(reader.getBookedStatsForOrgWindow).not.toHaveBeenCalled();
  });
});
