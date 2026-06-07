import { describe, it, expect, vi } from "vitest";
import { attributeOneRecommendation, runRileyOutcomeAttribution } from "../outcome-attribution.js";
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  MetaInsightsProvider,
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
  executableWorkUnitId: null,
};

function w(spendCents: number, ctr: number, dailyRowCount = 7): WindowMetrics {
  return { spendCents, ctr, dailyRowCount };
}

describe("attributeOneRecommendation — pause favorable", () => {
  it("renders pause.spend.fell when spend drops past noise floor", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(true);
    expect(row.copyTemplate).toBe("pause.spend.fell");
    expect(row.copyValues).toEqual({ deltaPct: -92, windowDays: 7 });
    expect(row.visibilityFlags).toEqual([]);
    expect(row.confidence).toBe("medium");
    expect(row.attributionMethod).toBe("directional");
    expect(row.windowStartedAt).toEqual(new Date("2026-04-24T12:00:00Z"));
    expect(row.windowEndedAt).toEqual(new Date("2026-05-08T12:00:00Z"));
  });
});

describe("attributeOneRecommendation — pause unfavorable", () => {
  it("renders pause.spend.changed when spend rises past noise floor", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(11000, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(true);
    expect(row.copyTemplate).toBe("pause.spend.changed");
    expect(row.copyValues?.deltaPct).toBe(10);
  });
});

describe("attributeOneRecommendation — pause below noise floor (pct)", () => {
  it("hides when |deltaPct| < 5", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(9700, 0.02), // -3%
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(["below_noise_floor"]);
    expect(row.copyTemplate).toBeNull();
  });
});

describe("attributeOneRecommendation — pause below absolute floor", () => {
  it("hides when |deltaAmountCents| < 500 even if pct passes", () => {
    // pre 100c, post 0c → deltaPct -100% (passes), deltaAmount -100c (fails $5 floor)
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(100, 0.02),
      postWindow: w(0, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(["below_noise_floor"]);
  });
});

describe("attributeOneRecommendation — refresh favorable", () => {
  it("renders refresh.ctr.rose when CTR rises past 10% noise floor", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0.02, 14),
      postWindow: w(50000, 0.024, 14), // +20%
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(true);
    expect(row.copyTemplate).toBe("refresh.ctr.rose");
    expect(row.copyValues).toEqual({ deltaPct: 20, windowDays: 14 });
    expect(row.confidence).toBe("low");
    expect(row.windowEndedAt).toEqual(
      new Date(REC.resolvedAt.getTime() + 14 * 24 * 60 * 60 * 1000),
    );
  });
});

describe("attributeOneRecommendation — refresh below noise floor", () => {
  it("hides when |deltaPct| < 10", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0.02, 14),
      postWindow: w(50000, 0.021, 14), // +5%
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(["below_noise_floor"]);
  });
});

describe("attributeOneRecommendation — zero pre baseline", () => {
  it("flags zero_pre_baseline for pause when preWindow.spendCents = 0", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(0, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toContain("zero_pre_baseline");
  });

  it("flags zero_pre_baseline for refresh when preWindow.ctr = 0", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0, 14),
      postWindow: w(50000, 0.02, 14),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toContain("zero_pre_baseline");
  });
});

describe("attributeOneRecommendation — sparse meta data", () => {
  it("flags meta_data_missing when post-window dailyRowCount < 50% of windowDays", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02, 7),
      postWindow: w(800, 0.02, 3), // 3 < 7 * 0.5
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toContain("meta_data_missing");
  });

  it("flags meta_data_missing when either window is null", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: null,
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toContain("meta_data_missing");
    expect(row.metricSummary.preWindow).toBeNull();
  });
});

describe("attributeOneRecommendation — overlap", () => {
  it("flags same_campaign_overlap when another acted rec exists on the same campaign", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [{ id: "rec-2", actionKind: "refresh_creative" }],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(expect.arrayContaining(["same_campaign_overlap"]));
    expect(row.visibilityFlags).not.toContain("same_kind_retry");
  });

  it("adds same_kind_retry as additive flag when overlap shares this kind", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [{ id: "rec-2", actionKind: "pause" }],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(
      expect.arrayContaining(["same_campaign_overlap", "same_kind_retry"]),
    );
  });
});

describe("attributeOneRecommendation — metricSummary always populated", () => {
  it("includes raw windows + window-day metadata for auditability", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.metricSummary.preWindowDays).toBe(7);
    expect(row.metricSummary.postWindowDays).toBe(7);
    expect(row.metricSummary.preWindow).toEqual(w(10000, 0.02));
    expect(row.metricSummary.postWindow).toEqual(w(800, 0.02));
    expect(row.metricSummary.deltas.deltaPct).toBe(-92);
    expect(row.metricSummary.deltas.deltaAmountCents).toBe(-9200);
  });
});

describe("attributeOneRecommendation — slice-3 enrichments (honesty floors)", () => {
  it("emits directional + trustDelta up for a clean favorable pause delta", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("up");
  });

  it("emits directional + trustDelta down for a clean unfavorable pause delta", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(11000, 0.02), // spend rose 10% after pause
      overlaps: [],
    });
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("down");
  });

  it("emits directional + trustDelta up for a clean favorable refresh delta", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0.02, 14),
      postWindow: w(50000, 0.024, 14), // CTR +20%
      overlaps: [],
    });
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("up");
  });

  it("emits directional + trustDelta down for a clean unfavorable refresh delta", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0.02, 14),
      postWindow: w(50000, 0.017, 14), // CTR -15%
      overlaps: [],
    });
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("down");
  });

  it("emits inconclusive + trustDelta none under every confidence-subtracting signal", () => {
    const flagged: Array<{ name: string; row: ReturnType<typeof attributeOneRecommendation> }> = [
      {
        name: "meta_data_missing (null window)",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: null,
          postWindow: w(800, 0.02),
          overlaps: [],
        }),
      },
      {
        name: "meta_data_missing (sparse dailyRowCount)",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: w(10000, 0.02, 7),
          postWindow: w(800, 0.02, 3),
          overlaps: [],
        }),
      },
      {
        name: "zero_pre_baseline",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: w(0, 0.02),
          postWindow: w(800, 0.02),
          overlaps: [],
        }),
      },
      {
        name: "below_noise_floor",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: w(10000, 0.02),
          postWindow: w(9700, 0.02),
          overlaps: [],
        }),
      },
      {
        name: "same_campaign_overlap / same_kind_retry",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: w(10000, 0.02),
          postWindow: w(800, 0.02),
          overlaps: [{ id: "rec-2", actionKind: "pause" }],
        }),
      },
    ];
    for (const { name, row } of flagged) {
      expect(row.causalStrength, name).toBe("inconclusive");
      expect(row.trustDelta, name).toBe("none");
    }
  });

  it("records businessContextStable as unknown when no operational-state source is wired (honest absence)", () => {
    const kinds = ["pause", "refresh_creative"] as const;
    for (const actionKind of kinds) {
      const candidate: AttributableRecommendation = { ...REC, actionKind };
      const clean = attributeOneRecommendation({
        candidate,
        preWindow: w(10000, 0.02, 14),
        postWindow: w(800, 0.024, 14),
        overlaps: [],
      });
      const contaminated = attributeOneRecommendation({
        candidate,
        preWindow: null,
        postWindow: null,
        overlaps: [{ id: "rec-2", actionKind }],
      });
      // Reader wired but zero confirmations for the window = same honest unknown.
      const emptySet = attributeOneRecommendation({
        candidate,
        preWindow: w(10000, 0.02, 14),
        postWindow: w(800, 0.024, 14),
        overlaps: [],
        operationalStateConfirmations: [],
      });
      expect(clean.businessContextStable, `${actionKind} clean`).toBe("unknown");
      expect(contaminated.businessContextStable, `${actionKind} contaminated`).toBe("unknown");
      expect(emptySet.businessContextStable, `${actionKind} empty set`).toBe("unknown");
    }
  });

  // Slice 4d: the corroborated-arm pins (the deliberate flip of the slice-3
  // never-emits-corroborated sweep) live in
  // outcome-attribution-corroboration.test.ts, split out to respect the
  // 600-line lint ceiling on this file.
});

describe("runRileyOutcomeAttribution — orchestration", () => {
  function buildDeps() {
    const recommendationStore: AttributableRecommendationStore = {
      findAttributableCandidates: vi.fn().mockResolvedValue([REC]),
      findOverlapsForCampaign: vi.fn().mockResolvedValue([]),
    };
    const insightsProvider: MetaInsightsProvider = {
      getWindowMetrics: vi.fn().mockImplementation(async ({ startInclusive }) => {
        return startInclusive.getTime() < REC.resolvedAt.getTime() ? w(10000, 0.02) : w(800, 0.02);
      }),
    };
    const outcomeStore: RecommendationOutcomeStore = {
      existsByRecommendationId: vi.fn().mockResolvedValue(false),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    return { recommendationStore, insightsProvider, outcomeStore };
  }

  it("writes an outcome row and returns a run summary", async () => {
    const deps = buildDeps();
    const summary = await runRileyOutcomeAttribution({
      ...deps,
      orgId: "org-1",
      now: new Date("2026-05-15T07:00:00Z"),
    });
    expect(deps.outcomeStore.insert).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      orgId: "org-1",
      candidatesScanned: 1,
      skippedExisting: 0,
      outcomesWritten: 1,
      renderable: 1,
      hidden: 0,
      hiddenByFlag: {
        meta_data_missing: 0,
        zero_pre_baseline: 0,
        below_noise_floor: 0,
        same_campaign_overlap: 0,
      },
    });
  });

  it("short-circuits when outcome already exists (skippedExisting++)", async () => {
    const deps = buildDeps();
    (deps.outcomeStore.existsByRecommendationId as ReturnType<typeof vi.fn>).mockResolvedValue(
      true,
    );
    const summary = await runRileyOutcomeAttribution({
      ...deps,
      orgId: "org-1",
      now: new Date("2026-05-15T07:00:00Z"),
    });
    expect(deps.insightsProvider.getWindowMetrics).not.toHaveBeenCalled();
    expect(deps.outcomeStore.insert).not.toHaveBeenCalled();
    expect(summary.skippedExisting).toBe(1);
    expect(summary.outcomesWritten).toBe(0);
  });

  it("writes hidden audit row + increments hiddenByFlag on contamination", async () => {
    const deps = buildDeps();
    (
      deps.recommendationStore.findOverlapsForCampaign as ReturnType<typeof vi.fn>
    ).mockResolvedValue([{ id: "rec-2", actionKind: "refresh_creative" }]);
    const summary = await runRileyOutcomeAttribution({
      ...deps,
      orgId: "org-1",
      now: new Date("2026-05-15T07:00:00Z"),
    });
    expect(deps.outcomeStore.insert).toHaveBeenCalledTimes(1);
    expect(summary.hidden).toBe(1);
    expect(summary.renderable).toBe(0);
    expect(summary.hiddenByFlag.same_campaign_overlap).toBe(1);
  });

  it("retries on Meta provider failure (let error propagate for Inngest retry)", async () => {
    const deps = buildDeps();
    (deps.insightsProvider.getWindowMetrics as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("meta 500"),
    );
    await expect(
      runRileyOutcomeAttribution({
        ...deps,
        orgId: "org-1",
        now: new Date("2026-05-15T07:00:00Z"),
      }),
    ).rejects.toThrow("meta 500");
    expect(deps.outcomeStore.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Slice 4c: businessContextStable from operational-state confirmations
// overlapping the full attribution window, and the trustDelta demotion.
// REC (pause) window: 2026-04-24T12:00Z .. 2026-05-08T12:00Z.
// ---------------------------------------------------------------------------
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
    id: `osc_${osSeq}`,
    organizationId: "org-1",
    state,
    confirmedBy: null,
    confirmedAt: new Date(confirmedAt),
    createdAt: new Date(confirmedAt),
  };
}

describe("attributeOneRecommendation: slice-4c stability consumption", () => {
  it("records stable from a fresh, complete, non-disruptive governing confirmation; trust signal unchanged", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
      operationalStateConfirmations: [osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL)],
    });
    expect(row.businessContextStable).toBe("stable");
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("up");
  });

  it("records unstable on a mid-window regime change and demotes trustDelta to none (a confounded outcome claims no trust signal)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
      operationalStateConfirmations: [
        osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL),
        osConfirm("2026-05-02T09:00:00.000Z", { ...OS_FULL_NORMAL, staffing: "shortfall" }),
      ],
    });
    expect(row.businessContextStable).toBe("unstable");
    // The factual outcome line still renders; only the trust claim is suppressed.
    expect(row.causalStrength).toBe("directional");
    expect(row.cockpitRenderable).toBe(true);
    expect(row.copyTemplate).toBe("pause.spend.fell");
    expect(row.trustDelta).toBe("none");
  });

  it("keeps causalStrength and stability orthogonal (flagged window + unstable context)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: null,
      postWindow: w(800, 0.02),
      overlaps: [],
      operationalStateConfirmations: [
        osConfirm("2026-04-26T09:00:00.000Z", {
          ...OS_FULL_NORMAL,
          operatingStatus: "temporarily_closed",
        }),
      ],
    });
    expect(row.causalStrength).toBe("inconclusive");
    expect(row.businessContextStable).toBe("unstable");
    expect(row.trustDelta).toBe("none");
  });
});

describe("runRileyOutcomeAttribution: operational-state reader threading (slice 4c)", () => {
  function makeOrchestratorDeps(candidates: AttributableRecommendation[]) {
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
        .mockResolvedValueOnce(w(10000, 0.02))
        .mockResolvedValueOnce(w(800, 0.02)),
    };
    return { recommendationStore, outcomeStore, insightsProvider, inserted };
  }

  it("queries the reader with the FULL attribution window and threads the verdict into the inserted row", async () => {
    const { recommendationStore, outcomeStore, insightsProvider, inserted } = makeOrchestratorDeps([
      REC,
    ]);
    const reader = {
      getConfirmationsOverlappingWindow: vi
        .fn()
        .mockResolvedValue([osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL)]),
    };

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      operationalStateReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    // The read is the 4a contract verbatim: (org, windowStartedAt, windowEndedAt),
    // the full pre+post span (anchor ± windowDays).
    expect(reader.getConfirmationsOverlappingWindow).toHaveBeenCalledWith(
      "org-1",
      new Date("2026-04-24T12:00:00Z"),
      new Date("2026-05-08T12:00:00Z"),
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.businessContextStable).toBe("stable");
  });

  it("records unknown when no reader is wired (back-compat, honest absence)", async () => {
    const { recommendationStore, outcomeStore, insightsProvider, inserted } = makeOrchestratorDeps([
      REC,
    ]);

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.businessContextStable).toBe("unknown");
  });

  it("propagates reader failures so Inngest retries (insert-once rows must not freeze a transient blip as permanent unknown)", async () => {
    const { recommendationStore, outcomeStore, insightsProvider } = makeOrchestratorDeps([REC]);
    const reader = {
      getConfirmationsOverlappingWindow: vi.fn().mockRejectedValue(new Error("db blip")),
    };

    await expect(
      runRileyOutcomeAttribution({
        recommendationStore,
        insightsProvider,
        outcomeStore,
        operationalStateReader: reader,
        orgId: "org-1",
        now: new Date("2026-05-10T12:00:00Z"),
      }),
    ).rejects.toThrow("db blip");
    expect(outcomeStore.insert).not.toHaveBeenCalled();
  });

  it("does not read confirmations for candidates skipped by the idempotency pre-check", async () => {
    const { recommendationStore, outcomeStore, insightsProvider } = makeOrchestratorDeps([REC]);
    (outcomeStore.existsByRecommendationId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const reader = { getConfirmationsOverlappingWindow: vi.fn() };

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      operationalStateReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    expect(reader.getConfirmationsOverlappingWindow).not.toHaveBeenCalled();
  });
});
