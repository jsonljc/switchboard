import { describe, it, expect, vi } from "vitest";
import { attributeOneRecommendation, runRileyOutcomeAttribution } from "../outcome-attribution.js";
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  MetaInsightsProvider,
  RecommendationOutcomeStore,
  WindowMetrics,
} from "../outcome-attribution-types.js";

const REC: AttributableRecommendation = {
  id: "rec-1",
  organizationId: "org-1",
  campaignId: "camp-A",
  actionKind: "pause",
  resolvedAt: new Date("2026-05-01T12:00:00Z"),
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
