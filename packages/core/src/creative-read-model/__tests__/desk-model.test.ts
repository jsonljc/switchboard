import { describe, it, expect } from "vitest";
import {
  buildMiraDeskModel,
  deriveDeskItemState,
  type MiraDeskItemState,
  type MiraDeskModel,
} from "../desk-model.js";
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

  it("tray items carry ugcPhase and an awaiting-go flag for pre-video gates (slice-3 spec 3.4)", () => {
    const rm: MiraCreativeReadModel = {
      jobs: [
        // a ugc job waiting at a pre-video gate (planning done, no draft yet)
        job({
          id: "ugc1",
          source: { engine: "legacy_creative_job", mode: "ugc" },
          status: "awaiting_review",
          ugcPhase: "scripting",
        }),
        // a polished job waiting at a pre-video stage gate: same flag
        job({ id: "pol1", status: "awaiting_review", stage: "scripts" }),
        // actively rendering, nothing to approve
        job({
          id: "ugc2",
          source: { engine: "legacy_creative_job", mode: "ugc" },
          status: "in_progress",
          ugcPhase: "planning",
        }),
      ],
      counts,
    };
    const model = buildMiraDeskModel(rm);
    const ugc1 = model.inProduction.find((i) => i.id === "ugc1")!;
    expect(ugc1.ugcPhase).toBe("scripting");
    expect(ugc1.awaitingGo).toBe(true);
    const pol1 = model.inProduction.find((i) => i.id === "pol1")!;
    expect(pol1.awaitingGo).toBe(true);
    expect(pol1.ugcPhase).toBeUndefined();
    const ugc2 = model.inProduction.find((i) => i.id === "ugc2")!;
    expect(ugc2.awaitingGo).toBe(false);
  });

  it("reports empty when there are no jobs", () => {
    expect(buildMiraDeskModel({ jobs: [], counts }).isEmpty).toBe(true);
  });
});

describe("buildMiraDeskModel — review decisions (PR4)", () => {
  it("kept drafts go to the shelf (approved_draft); passed drafts disappear; decided ⇒ not ready-to-review", () => {
    const jobs: MiraCreativeJobSummary[] = [
      job({ id: "r1", status: "draft_ready", draft: { videoUrl: "x" } }), // undecided → ready
      job({
        id: "k1",
        status: "draft_ready",
        draft: { videoUrl: "y", thumbnailUrl: "t1" },
        reviewDecision: "kept",
      }),
      job({ id: "x1", status: "draft_ready", draft: { videoUrl: "z" }, reviewDecision: "passed" }),
    ];
    const desk: MiraDeskModel = buildMiraDeskModel({ jobs, counts: { ...counts, total: 3 } });
    expect(desk.readyToReviewCount).toBe(1); // only the undecided one
    expect(desk.keptDrafts.map((i) => i.id)).toEqual(["k1"]); // kept → shelf
    expect(desk.keptDrafts[0]?.state).toBe("approved_draft");
    expect(desk.keptDrafts[0]?.thumbnailUrl).toBe("t1");
    // passed (x1) appears in neither bucket.
    expect(desk.inProduction).toEqual([]);
    // no publish failures here → the attention bucket stays empty.
    expect(desk.needsAttention).toEqual([]);
  });
});

describe("buildMiraDeskModel — publish failures (D9-F3)", () => {
  it("routes a kept draft whose publish failed into needsAttention with a publish_failed problem (not the calm kept shelf)", () => {
    const jobs: MiraCreativeJobSummary[] = [
      job({
        id: "pf",
        status: "draft_ready",
        draft: { videoUrl: "v", thumbnailUrl: "t" },
        reviewDecision: "kept",
        publishStatus: "publish_failed",
      }),
    ];
    const desk = buildMiraDeskModel({ jobs, counts: { ...counts, total: 1 } });
    expect(desk.needsAttention.map((i) => i.id)).toEqual(["pf"]);
    expect(desk.needsAttention[0]?.problem).toBe("publish_failed");
    expect(desk.needsAttention[0]?.state).toBe("approved_draft");
    // It must NOT also sit silently in the calm kept shelf.
    expect(desk.keptDrafts).toEqual([]);
  });

  it("keeps a successfully parked publish in the kept shelf (a success is not a problem)", () => {
    const jobs: MiraCreativeJobSummary[] = [
      job({
        id: "ok",
        status: "draft_ready",
        draft: { videoUrl: "v", thumbnailUrl: "t" },
        reviewDecision: "kept",
        publishStatus: "parked_paused",
      }),
    ];
    const desk = buildMiraDeskModel({ jobs, counts: { ...counts, total: 1 } });
    expect(desk.keptDrafts.map((i) => i.id)).toEqual(["ok"]);
    expect(desk.keptDrafts[0]?.problem).toBeUndefined();
    expect(desk.needsAttention).toEqual([]);
  });

  it("drops a publish failure the operator already dismissed (passed) from every bucket", () => {
    const jobs: MiraCreativeJobSummary[] = [
      job({
        id: "pp",
        status: "draft_ready",
        draft: { videoUrl: "v" },
        reviewDecision: "passed",
        publishStatus: "publish_failed",
      }),
    ];
    const desk = buildMiraDeskModel({ jobs, counts: { ...counts, total: 1 } });
    expect(desk.needsAttention).toEqual([]);
    expect(desk.keptDrafts).toEqual([]);
  });

  it("leaves needsAttention empty for ordinary kept/ready drafts and keeps isEmpty independent", () => {
    const jobs: MiraCreativeJobSummary[] = [
      job({ id: "k", status: "draft_ready", draft: { videoUrl: "v" }, reviewDecision: "kept" }),
      job({ id: "r", status: "draft_ready", draft: { videoUrl: "w" } }),
    ];
    const desk = buildMiraDeskModel({ jobs, counts: { ...counts, total: 2 } });
    expect(desk.needsAttention).toEqual([]);
    expect(desk.keptDrafts.map((i) => i.id)).toEqual(["k"]);
    expect(desk.isEmpty).toBe(false);
  });

  it("lets a render failure outrank a stray publish marker (defensive precedence)", () => {
    // status:"failed" + publishStatus never co-occur in real data (publish runs
    // only after a kept draft_ready); pin the precedence so a future refactor
    // cannot mislabel a render failure as a publish failure.
    const jobs: MiraCreativeJobSummary[] = [
      job({ id: "x", status: "failed", publishStatus: "publish_failed" }),
    ];
    const desk = buildMiraDeskModel({ jobs, counts: { ...counts, total: 1 } });
    expect(desk.inProduction.find((i) => i.id === "x")?.problem).toBe("quality_failed");
    expect(desk.needsAttention).toEqual([]);
  });

  it("keeps the attention bucket to genuine publish failures (membership tracks the derived problem)", () => {
    // A kept draft that is render-failed AND carries a publish marker is
    // unreachable in real data, but pin the invariant: needsAttention ⇔ a
    // publish_failed problem, so render failure (quality_failed) can never land
    // there wearing a publish-failed badge.
    const jobs: MiraCreativeJobSummary[] = [
      job({ id: "rf", status: "failed", reviewDecision: "kept", publishStatus: "publish_failed" }),
    ];
    const desk = buildMiraDeskModel({ jobs, counts: { ...counts, total: 1 } });
    expect(desk.needsAttention).toEqual([]);
  });
});
