import { describe, expect, it } from "vitest";
import type { CreativeJob } from "@switchboard/schemas";
import { buildMiraCreativeReadModel } from "../build-read-model.js";

const NOW = new Date("2026-05-28T12:00:00Z");
const WEEK_START = new Date("2026-05-25T00:00:00Z");
const PREV_WEEK_START = new Date("2026-05-18T00:00:00Z");

function job(o: Partial<CreativeJob>): CreativeJob {
  return {
    id: "j",
    taskId: "t",
    organizationId: "org1",
    deploymentId: "d1",
    productDescription: "P",
    targetAudience: "a",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    generateReferenceImages: false,
    productionTier: null,
    currentStage: "trends",
    stageOutputs: {},
    stoppedAt: null,
    mode: "polished",
    ugcPhase: null,
    ugcPhaseOutputs: null,
    ugcPhaseOutputsVersion: null,
    ugcConfig: null,
    ugcFailure: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  } as CreativeJob;
}

// A valid measured_performance row (mirrors performance-projection.test.ts):
// derivePerformance() parses this into a `delivery: "measured"` summary.
const MEASURED_ROW = {
  kind: "measured_performance",
  version: 1,
  asOf: "2026-06-04T06:30:00.000Z",
  window: { from: "2026-05-05T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z", days: 30 },
  delivery: "measured",
  join: { metaCampaignId: "camp-1", metaAdId: "ad-1", metaVideoId: "vid-1" },
  meta: {
    spend: 50,
    impressions: 1000,
    inlineLinkClicks: 40,
    inlineLinkClickCtr: 4,
    conversions: 3,
    cpm: 50,
  },
  booked: { valueCents: 25000, count: 2 },
  trueRoas: 5,
  source: { insights: "meta_campaign_insights", conversions: "conversion_records" },
};

describe("buildMiraCreativeReadModel", () => {
  const opts = { now: NOW, weekStart: WEEK_START, prevWeekStart: PREV_WEEK_START, visibleLimit: 5 };

  it("projects ugcPhase on ugc summaries only (slice-3 spec 3.4: mode-honest labels)", () => {
    const rm = buildMiraCreativeReadModel(
      [
        job({ id: "u1", mode: "ugc", ugcPhase: "production", ugcPhaseOutputs: { planning: {} } }),
        job({ id: "p1" }),
      ],
      opts,
    );
    expect(rm.jobs.find((j) => j.id === "u1")!.ugcPhase).toBe("production");
    expect(rm.jobs.find((j) => j.id === "p1")!.ugcPhase).toBeUndefined();
  });

  it("surfaces metaPublishStatus as publishStatus, orthogonal to the render status (D9-F3)", () => {
    const base = { currentStage: "complete" as const, stageOutputs: { trends: {} } };
    const rm = buildMiraCreativeReadModel(
      [
        job({ id: "failed", ...base, metaPublishStatus: "publish_failed" }),
        job({ id: "parked", ...base, metaPublishStatus: "parked_paused" }),
        job({ id: "none", ...base, metaPublishStatus: null }),
        job({ id: "unknown", ...base, metaPublishStatus: "something_else" }),
      ],
      opts,
    );
    const byId = (id: string) => rm.jobs.find((j) => j.id === id)!;
    expect(byId("failed").publishStatus).toBe("publish_failed");
    expect(byId("parked").publishStatus).toBe("parked_paused");
    expect(byId("none").publishStatus).toBeUndefined();
    expect(byId("unknown").publishStatus).toBeUndefined();
    // A render-complete job whose publish failed still reads draft_ready: the
    // publish lifecycle is a separate axis from the render status.
    expect(byId("failed").status).toBe("draft_ready");
  });

  it("empty org → empty jobs, zero counts", () => {
    const rm = buildMiraCreativeReadModel([], opts);
    expect(rm.jobs).toEqual([]);
    expect(rm.counts).toEqual({
      total: 0,
      shippedThisWeek: 0,
      shippedPrevWeek: 0,
      inFlight: 0,
      awaitingReview: 0,
      stopped: 0,
      measuredCount: 0,
    });
  });

  it("counts inFlight, awaitingReview, stopped, and weekly completions", () => {
    const rm = buildMiraCreativeReadModel(
      [
        job({ id: "a", currentStage: "hooks", stageOutputs: { trends: {} } }), // awaiting_review
        job({ id: "b", currentStage: "trends", stageOutputs: {} }), // in_progress
        job({ id: "c", stoppedAt: "scripts" }), // stopped
        job({
          id: "d",
          currentStage: "complete",
          stageOutputs: { production: {} },
          updatedAt: new Date("2026-05-26"),
        }), // shippedThisWeek
        job({
          id: "e",
          currentStage: "complete",
          stageOutputs: { production: {} },
          updatedAt: new Date("2026-05-19"),
        }), // shippedPrevWeek
      ],
      opts,
    );
    expect(rm.counts).toEqual({
      total: 5,
      shippedThisWeek: 1,
      shippedPrevWeek: 1,
      inFlight: 2,
      awaitingReview: 1,
      stopped: 1,
      measuredCount: 0,
    });
  });

  it("never emits status 'shipped' in M1", () => {
    const rm = buildMiraCreativeReadModel(
      [job({ currentStage: "complete", stageOutputs: { production: {} } })],
      opts,
    );
    expect(rm.jobs.every((j) => j.status !== "shipped")).toBe(true);
    expect(rm.jobs[0]!.status).toBe("draft_ready");
  });

  it("slices visible jobs to visibleLimit but counts ALL", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      job({ id: `j${i}`, currentStage: "hooks", stageOutputs: { trends: {} } }),
    );
    const rm = buildMiraCreativeReadModel(many, { ...opts, visibleLimit: 5 });
    expect(rm.jobs).toHaveLength(5);
    expect(rm.counts.awaitingReview).toBe(8);
    expect(rm.counts.total).toBe(8); // counts cover ALL fetched jobs, not just the visible slice
  });

  it("counts measured jobs across the FULL cohort, not just the visible slice (P1-8)", () => {
    // Input order == display order; the lone measured job is the oldest (index 6),
    // so it falls OUTSIDE the visible 5. The self-brief measured-signal floor reads
    // counts.measuredCount, so it must be computed over the whole cohort (like inFlight),
    // not the sliced jobs — else a measured creative outside the newest 5 is invisible.
    const base = { currentStage: "complete" as const, stageOutputs: { production: {} } };
    const jobs = [
      ...Array.from({ length: 6 }, (_, i) => job({ id: `unmeasured-${i}`, ...base })),
      job({ id: "measured-tail", ...base, pastPerformance: MEASURED_ROW }),
    ];
    const rm = buildMiraCreativeReadModel(jobs, { ...opts, visibleLimit: 5 });
    // The measured job is NOT in the visible slice...
    expect(rm.jobs).toHaveLength(5);
    expect(rm.jobs.some((j) => j.id === "measured-tail")).toBe(false);
    // ...but the cohort-wide measured count still sees it.
    expect(rm.counts.measuredCount).toBe(1);
  });

  it("maps draft video + reviewAction on awaiting_review", () => {
    const rm = buildMiraCreativeReadModel(
      [
        job({
          id: "a",
          currentStage: "complete",
          stageOutputs: {
            production: { assembledVideos: [{ videoUrl: "v", thumbnailUrl: "t", duration: 12 }] },
          },
        }),
      ],
      opts,
    );
    expect(rm.jobs[0]!.draft).toEqual({ videoUrl: "v", thumbnailUrl: "t", durationSec: 12 });
    expect(rm.jobs[0]!.reviewAction.label).toBe("review_draft");
  });
});
