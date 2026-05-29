import { describe, expect, it } from "vitest";
import type { CreativeJob } from "@switchboard/schemas";
import { mapCreativeJobToMiraStatus, deriveReviewAction, deriveDraft } from "../status-mapper.js";

function job(overrides: Partial<CreativeJob>): CreativeJob {
  return {
    id: "j1",
    taskId: "t1",
    organizationId: "org1",
    deploymentId: "d1",
    productDescription: "A product",
    targetAudience: "people",
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
    createdAt: new Date("2026-05-20"),
    updatedAt: new Date("2026-05-20"),
    ...overrides,
  } as CreativeJob;
}

function ugcJob(overrides: Partial<CreativeJob>): CreativeJob {
  return job({
    mode: "ugc",
    ugcPhase: "planning",
    ugcPhaseOutputs: null,
    ...overrides,
  });
}

describe("mapCreativeJobToMiraStatus", () => {
  it("ugc failure → failed", () => {
    expect(mapCreativeJobToMiraStatus(job({ mode: "ugc", ugcFailure: { msg: "x" } }))).toBe(
      "failed",
    );
  });
  it("polished production errors with no video → failed", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          currentStage: "complete",
          stageOutputs: { production: { errors: [{ message: "boom" }] } },
        }),
      ),
    ).toBe("failed");
  });
  it("complete WITH assembled video despite errors → draft_ready", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          currentStage: "complete",
          stageOutputs: {
            production: { errors: [{ message: "minor" }], assembledVideos: [{ videoUrl: "v" }] },
          },
        }),
      ),
    ).toBe("draft_ready");
  });
  it("stoppedAt set → stopped", () => {
    expect(mapCreativeJobToMiraStatus(job({ stoppedAt: "hooks" }))).toBe("stopped");
  });
  it("currentStage complete (clean) → draft_ready", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({ currentStage: "complete", stageOutputs: { production: {} } }),
      ),
    ).toBe("draft_ready");
  });
  it("mid-pipeline with outputs → awaiting_review", () => {
    expect(
      mapCreativeJobToMiraStatus(job({ currentStage: "hooks", stageOutputs: { trends: {} } })),
    ).toBe("awaiting_review");
  });
  it("fresh job, empty outputs → in_progress", () => {
    expect(mapCreativeJobToMiraStatus(job({ currentStage: "trends", stageOutputs: {} }))).toBe(
      "in_progress",
    );
  });
  it("malformed stageOutputs (string) → does not throw, treated as no-output", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({ stageOutputs: "garbage" as unknown as Record<string, unknown> }),
      ),
    ).toBe("in_progress");
  });
});

describe("mapCreativeJobToMiraStatus — UGC lifecycle", () => {
  it("ugc failure → failed", () => {
    expect(mapCreativeJobToMiraStatus(ugcJob({ ugcFailure: { msg: "x" } }))).toBe("failed");
  });

  it("ugc-complete → draft_ready", () => {
    expect(
      mapCreativeJobToMiraStatus(
        ugcJob({
          ugcPhase: "complete",
          ugcPhaseOutputs: { planning: {}, scripting: {}, production: {}, delivery: {} },
        }),
      ),
    ).toBe("draft_ready");
  });

  it("ugc-fresh (planning phase, empty outputs) → in_progress", () => {
    expect(
      mapCreativeJobToMiraStatus(ugcJob({ ugcPhase: "planning", ugcPhaseOutputs: null })),
    ).toBe("in_progress");
  });

  it("ugc-mid (non-empty ugcPhaseOutputs, phase not complete) → awaiting_review", () => {
    expect(
      mapCreativeJobToMiraStatus(
        ugcJob({
          ugcPhase: "scripting",
          ugcPhaseOutputs: { planning: { structures: [] } },
        }),
      ),
    ).toBe("awaiting_review");
  });

  it("ugc-stopped (stoppedAt set) → stopped", () => {
    expect(
      mapCreativeJobToMiraStatus(
        ugcJob({
          stoppedAt: "production",
          ugcPhase: "production",
          ugcPhaseOutputs: { planning: {} },
        }),
      ),
    ).toBe("stopped");
  });
});

describe("deriveDraft — UGC lifecycle", () => {
  it("ugc-complete with production assets → returns videoUrl from outputs", () => {
    const draft = deriveDraft(
      ugcJob({
        ugcPhase: "complete",
        ugcPhaseOutputs: {
          production: {
            assets: [
              {
                outputs: { videoUrl: "https://cdn.example.com/ugc-video.mp4", checksums: {} },
                specId: "s1",
                creatorId: "c1",
              },
            ],
            qaResults: {},
            failedSpecs: [],
          },
        },
      }),
    );
    expect(draft).toEqual({ videoUrl: "https://cdn.example.com/ugc-video.mp4" });
  });

  it("ugc delivery phase with videoUrl → prefers delivery over production", () => {
    const draft = deriveDraft(
      ugcJob({
        ugcPhase: "complete",
        ugcPhaseOutputs: {
          production: {
            assets: [{ outputs: { videoUrl: "https://cdn.example.com/raw.mp4", checksums: {} } }],
            failedSpecs: [],
          },
          delivery: { videoUrl: "https://cdn.example.com/final.mp4" },
        },
      }),
    );
    expect(draft).toEqual({ videoUrl: "https://cdn.example.com/final.mp4" });
  });

  it("ugc with no outputs → returns undefined", () => {
    expect(deriveDraft(ugcJob({ ugcPhaseOutputs: null }))).toBeUndefined();
  });
});

describe("deriveReviewAction", () => {
  it("awaiting_review → continue+stop", () => {
    expect(deriveReviewAction("awaiting_review")).toEqual({
      canContinue: true,
      canStop: true,
      label: "continue_draft",
    });
  });
  it("in_progress → stop only", () => {
    expect(deriveReviewAction("in_progress")).toEqual({
      canContinue: false,
      canStop: true,
      label: "none",
    });
  });
  it("draft_ready → review only", () => {
    expect(deriveReviewAction("draft_ready")).toEqual({
      canContinue: false,
      canStop: false,
      label: "review_draft",
    });
  });
  it("stopped/failed → none", () => {
    expect(deriveReviewAction("stopped")).toEqual({
      canContinue: false,
      canStop: false,
      label: "none",
    });
    expect(deriveReviewAction("failed")).toEqual({
      canContinue: false,
      canStop: false,
      label: "none",
    });
  });
});
