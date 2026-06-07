import { describe, it, expect, vi } from "vitest";
import { attributeOneRecommendation, runRileyOutcomeAttribution } from "../outcome-attribution.js";
import type {
  AttributableRecommendation,
  MetaInsightsProvider,
  RileyOutcomeRow,
  WindowMetrics,
} from "../outcome-attribution-types.js";
import type { OperationalState, OperationalStateConfirmation } from "@switchboard/schemas";

// Pause candidate: windowDays = 7, anchor 2026-05-01T12:00Z, so the full
// attribution window is [2026-04-24T12:00Z, 2026-05-08T12:00Z) and NOW sits
// past the 24h settlement lag, like every live candidate.
const REC: AttributableRecommendation = {
  id: "rec-late-1",
  organizationId: "org-1",
  campaignId: "camp-A",
  actionKind: "pause",
  resolvedAt: new Date("2026-05-01T12:00:00Z"),
  executableWorkUnitId: null,
};
const NOW = new Date("2026-05-10T12:00:00Z");
const WINDOW_START = new Date("2026-04-24T12:00:00Z");
const WINDOW_END = new Date("2026-05-08T12:00:00Z");

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
    id: `osc_orch_${seq}`,
    organizationId: "org-1",
    state,
    confirmedBy: null,
    confirmedAt: new Date(confirmedAt),
    createdAt: new Date(confirmedAt),
  };
}

/** Governing row 3 days before window entry: certifies stable alone. */
function governing(): OperationalStateConfirmation {
  return confirm("2026-04-21T12:00:00Z", FULL_NORMAL);
}

/** Late closure overlapping the measured window, recorded after windowEnd. */
function lateClosure(): OperationalStateConfirmation {
  return confirm("2026-05-09T12:00:00Z", {
    closures: [{ start: "2026-04-28T00:00:00Z", end: "2026-05-02T00:00:00Z" }],
  });
}

function w(spendCents: number, ctr = 0.02, dailyRowCount = 7): WindowMetrics {
  return { spendCents, ctr, dailyRowCount };
}

function makeDeps(confirmations: OperationalStateConfirmation[]) {
  const inserted: RileyOutcomeRow[] = [];
  const insightsProvider: MetaInsightsProvider = {
    getWindowMetrics: vi.fn().mockResolvedValueOnce(w(10000)).mockResolvedValueOnce(w(800)),
  };
  return {
    recommendationStore: {
      findAttributableCandidates: vi.fn().mockResolvedValue([REC]),
      findOverlapsForCampaign: vi.fn().mockResolvedValue([]),
    },
    insightsProvider,
    outcomeStore: {
      insert: vi.fn(async (row: RileyOutcomeRow) => {
        inserted.push(row);
      }),
      existsByRecommendationId: vi.fn().mockResolvedValue(false),
    },
    reader: {
      getConfirmationsOverlappingWindow: vi.fn().mockResolvedValue(confirmations),
    },
    inserted,
  };
}

async function run(deps: ReturnType<typeof makeDeps>, now = NOW) {
  return runRileyOutcomeAttribution({
    recommendationStore: deps.recommendationStore,
    insightsProvider: deps.insightsProvider,
    outcomeStore: deps.outcomeStore,
    operationalStateReader: deps.reader,
    orgId: "org-1",
    now,
  });
}

describe("runRileyOutcomeAttribution: the slice-4e widened operational-state read", () => {
  it("calls the reader with the attribution moment as the end bound (late rows admissible)", async () => {
    const deps = makeDeps([governing()]);
    await run(deps);
    expect(deps.reader.getConfirmationsOverlappingWindow).toHaveBeenCalledWith(
      "org-1",
      WINDOW_START,
      NOW,
    );
  });

  it("never narrows below the 4c read: a now before postEnd clamps to postEnd", async () => {
    // Unreachable from the live candidate store (settlement lag enforces
    // now >= postEnd + 24h); the clamp protects direct callers regardless.
    const deps = makeDeps([]);
    await run(deps, new Date("2026-05-08T00:00:00Z"));
    expect(deps.reader.getConfirmationsOverlappingWindow).toHaveBeenCalledWith(
      "org-1",
      WINDOW_START,
      WINDOW_END,
    );
  });

  it("records unstable + trustDelta none when a late closure overlaps the measured window", async () => {
    const deps = makeDeps([governing(), lateClosure()]);
    const summary = await run(deps);
    expect(summary.outcomesWritten).toBe(1);
    expect(deps.inserted).toHaveLength(1);
    expect(deps.inserted[0]?.businessContextStable).toBe("unstable");
    // The delta is real; only the trust suffix is suppressed (4c demotion).
    expect(deps.inserted[0]?.trustDelta).toBe("none");
    expect(deps.inserted[0]?.cockpitRenderable).toBe(true);
  });

  it("keeps stable + trustDelta up when the only late row is scalar-only", async () => {
    const deps = makeDeps([
      governing(),
      confirm("2026-05-09T12:00:00Z", { staffing: "shortfall" }),
    ]);
    await run(deps);
    expect(deps.inserted[0]?.businessContextStable).toBe("stable");
    expect(deps.inserted[0]?.trustDelta).toBe("up");
  });
});

describe("attributeOneRecommendation: late evidence reaches corroboration P4 (slice 4d ordering)", () => {
  // Inputs that pass every corroboration gate when the window is stable:
  // P1 pause, P2 clean -92% delta, P3 favorable, F1 reader+spend present,
  // F2 5 bookings each window, F3 post/pre account spend 0.8 in [0.5, 1.5],
  // A1 postRatio 2.375 >= 0.8 * preRatio 2.0.
  const corroborationInputs = {
    preWindow: { ...w(10000), accountSpendCents: 50000 },
    postWindow: { ...w(800), accountSpendCents: 40000 },
    orgBookedStats: {
      preWindow: { bookedValueCents: 100000, bookedCount: 5 },
      postWindow: { bookedValueCents: 95000, bookedCount: 5 },
    },
  };

  it("emits corroborated when the window is late-undisturbed (the control)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      ...corroborationInputs,
      overlaps: [],
      operationalStateConfirmations: [governing()],
    });
    expect(row.businessContextStable).toBe("stable");
    expect(row.causalStrength).toBe("corroborated");
  });

  it("demotes to directional when a late closure disrupts the window (P4 consumes the post-late-read verdict)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      ...corroborationInputs,
      overlaps: [],
      operationalStateConfirmations: [governing(), lateClosure()],
    });
    expect(row.businessContextStable).toBe("unstable");
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("none");
  });

  it("leaves corroborated earnable when the late row is scalar-only (intervals-only negative)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      ...corroborationInputs,
      overlaps: [],
      operationalStateConfirmations: [
        governing(),
        confirm("2026-05-09T12:00:00Z", { operatingStatus: "temporarily_closed" }),
      ],
    });
    expect(row.businessContextStable).toBe("stable");
    expect(row.causalStrength).toBe("corroborated");
  });

  it("byte-identity: benign late rows leave the entire row deep-equal", () => {
    const base = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000),
      postWindow: w(800),
      overlaps: [],
      operationalStateConfirmations: [governing()],
    });
    const withBenignLate = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000),
      postWindow: w(800),
      overlaps: [],
      operationalStateConfirmations: [
        governing(),
        confirm("2026-05-09T12:00:00Z", {
          staffing: "shortfall",
          closures: [{ start: "2026-05-20T00:00:00Z", end: "2026-05-25T00:00:00Z" }],
        }),
      ],
    });
    expect(withBenignLate).toEqual(base);
  });
});
