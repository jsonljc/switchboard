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
