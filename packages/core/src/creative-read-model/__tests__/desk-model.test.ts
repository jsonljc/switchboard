import { describe, it, expect } from "vitest";
import { buildMiraDeskModel, deriveDeskItemState, type MiraDeskItemState } from "../desk-model.js";
import type {
  MiraCreativeJobSummary,
  MiraCreativeReadModel,
  MiraCreativeCounts,
} from "../types.js";

const FORBIDDEN: string[] = [
  "sent_to_riley",
  "in_use",
  "learning",
  "winner",
  "fatigued",
  "published",
];

function job(over: Partial<MiraCreativeJobSummary>): MiraCreativeJobSummary {
  return {
    id: "j",
    title: "Summer Botox promo",
    stage: "production",
    status: "in_progress",
    reviewAction: { canContinue: false, canStop: false, label: "none" },
    source: { engine: "legacy_creative_job", mode: "polished" },
    createdAt: "2026-05-26T10:00:00Z",
    updatedAt: "2026-05-26T10:00:00Z",
    ...over,
  };
}

const counts: MiraCreativeCounts = {
  total: 0,
  shippedThisWeek: 0,
  shippedPrevWeek: 0,
  inFlight: 0,
  awaitingReview: 0,
  stopped: 0,
};

describe("deriveDeskItemState", () => {
  it("maps every seam status to an ALLOWED state and never a forbidden one", () => {
    const cases: Array<[MiraCreativeJobSummary, MiraDeskItemState]> = [
      [job({ status: "in_progress" }), "in_production"],
      [job({ status: "awaiting_review" }), "in_production"], // no video → still producing
      [job({ status: "awaiting_review", draft: { videoUrl: "x" } }), "ready_to_review"],
      [job({ status: "draft_ready", draft: { videoUrl: "x" } }), "ready_to_review"],
      [job({ status: "draft_ready" }), "ready_to_review"], // draft_ready maps unconditionally (no video guard)
      [job({ status: "stopped" }), "reviewed_stopped"],
      [job({ status: "failed" }), "in_production"],
      // `shipped` is never emitted by the seam (build-read-model.ts:48); mapped
      // defensively so the switch stays exhaustive. The REAL approved_draft
      // producer is the Keep gesture (PR4), not status.
      [job({ status: "shipped", draft: { videoUrl: "x" } }), "approved_draft"],
    ];
    for (const [j, expected] of cases) {
      const state = deriveDeskItemState(j);
      expect(state).toBe(expected);
      expect(FORBIDDEN).not.toContain(state);
    }
  });
});

describe("buildMiraDeskModel", () => {
  it("buckets jobs into the tray and ready-count; failed items carry a quality_failed problem", () => {
    const jobs: MiraCreativeJobSummary[] = [
      job({ id: "p1", status: "in_progress" }),
      job({ id: "f1", status: "failed" }),
      job({ id: "r1", status: "draft_ready", draft: { videoUrl: "x" } }),
      job({ id: "r2", status: "draft_ready", draft: { videoUrl: "y" } }),
      job({ id: "s1", status: "stopped" }),
    ];
    const rm: MiraCreativeReadModel = { jobs, counts: { ...counts, total: 5 } };
    const desk = buildMiraDeskModel(rm);

    expect(desk.inProduction.map((i) => i.id).sort()).toEqual(["f1", "p1"]);
    expect(desk.inProduction.find((i) => i.id === "f1")?.problem).toBe("quality_failed");
    expect(desk.readyToReviewCount).toBe(2);
    expect(desk.isEmpty).toBe(false);
  });

  it("reports empty when there are no jobs", () => {
    expect(buildMiraDeskModel({ jobs: [], counts }).isEmpty).toBe(true);
  });
});
