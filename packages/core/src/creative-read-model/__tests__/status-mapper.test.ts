import { describe, expect, it } from "vitest";
import type { CreativeJob } from "@switchboard/schemas";
import {
  mapCreativeJobToMiraStatus,
  deriveReviewAction,
  deriveDraft,
  deriveQa,
} from "../status-mapper.js";

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
  it("polished stageFailure → failed (beats awaiting_review)", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          currentStage: "hooks",
          stageOutputs: { trends: { angles: [] } },
          stageFailure: { kind: "terminal", code: "ASYNC_JOB_FAILED", message: "boom" },
        }),
      ),
    ).toBe("failed");
  });
  it("null stageFailure leaves polished status unchanged (awaiting_review)", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          currentStage: "hooks",
          stageOutputs: { trends: { angles: [] } },
          stageFailure: null,
        }),
      ),
    ).toBe("awaiting_review");
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

  // ── Slice-3 frame QA (spec 3.1 consumers) ──

  it("prefers the first non-rejected asset for the draft", () => {
    const draft = deriveDraft(
      ugcJob({
        ugcPhase: "complete",
        ugcPhaseOutputs: {
          production: {
            assets: [
              { approvalState: "rejected", outputs: { videoUrl: "https://c.example/bad.mp4" } },
              { approvalState: "approved", outputs: { videoUrl: "https://c.example/good.mp4" } },
            ],
            failedSpecs: [],
          },
        },
      }),
    );
    expect(draft?.videoUrl).toBe("https://c.example/good.mp4");
  });

  it("falls back to assets[0] when every asset is rejected (operator can see what failed)", () => {
    const draft = deriveDraft(
      ugcJob({
        ugcPhase: "complete",
        ugcPhaseOutputs: {
          production: {
            assets: [
              { approvalState: "rejected", outputs: { videoUrl: "https://c.example/bad1.mp4" } },
              { approvalState: "rejected", outputs: { videoUrl: "https://c.example/bad2.mp4" } },
            ],
            failedSpecs: [],
          },
        },
      }),
    );
    expect(draft?.videoUrl).toBe("https://c.example/bad1.mp4");
  });
});

describe("slice-3 all-rejected status rule", () => {
  const allRejectedOutputs = {
    production: {
      assets: [
        { approvalState: "rejected", outputs: { videoUrl: "https://c.example/bad1.mp4" } },
        { approvalState: "rejected", outputs: { videoUrl: "https://c.example/bad2.mp4" } },
      ],
      failedSpecs: [{ specId: "s1", reason: "qa_failed" }],
    },
  };

  it("ugc complete with every asset rejected → failed, not draft_ready", () => {
    expect(
      mapCreativeJobToMiraStatus(
        ugcJob({ ugcPhase: "complete", ugcPhaseOutputs: allRejectedOutputs }),
      ),
    ).toBe("failed");
  });

  it("fires at the production gate too (ugcPhase delivery): the approve is pre-empted", () => {
    expect(
      mapCreativeJobToMiraStatus(
        ugcJob({ ugcPhase: "delivery", ugcPhaseOutputs: allRejectedOutputs }),
      ),
    ).toBe("failed");
  });

  it("one rejected one approved → unchanged (draft_ready when complete)", () => {
    expect(
      mapCreativeJobToMiraStatus(
        ugcJob({
          ugcPhase: "complete",
          ugcPhaseOutputs: {
            production: {
              assets: [
                { approvalState: "rejected", outputs: { videoUrl: "https://c.example/b.mp4" } },
                { approvalState: "approved", outputs: { videoUrl: "https://c.example/g.mp4" } },
              ],
              failedSpecs: [],
            },
          },
        }),
      ),
    ).toBe("draft_ready");
  });

  it("no production output yet → untouched (awaiting_review path)", () => {
    expect(
      mapCreativeJobToMiraStatus(
        ugcJob({ ugcPhase: "scripting", ugcPhaseOutputs: { planning: { structures: [] } } }),
      ),
    ).toBe("awaiting_review");
  });

  it("failed beats a later stop (rule sits with the failure rules)", () => {
    expect(
      mapCreativeJobToMiraStatus(
        ugcJob({
          ugcPhase: "complete",
          ugcPhaseOutputs: allRejectedOutputs,
          stoppedAt: "production",
        }),
      ),
    ).toBe("failed");
  });
});

describe("deriveQa (slice-3 desk verdict)", () => {
  const evaluatedPass = {
    hardChecks: { artifactFlags: [] },
    softScores: { visualRealism: 0.8 },
    overallDecision: "pass",
    qaStatus: "evaluated",
  };

  it("projects the draft-chosen asset's qa verdict", () => {
    const qa = deriveQa(
      ugcJob({
        ugcPhase: "complete",
        ugcPhaseOutputs: {
          production: {
            assets: [
              {
                approvalState: "approved",
                qaMetrics: evaluatedPass,
                outputs: { videoUrl: "https://c.example/g.mp4" },
              },
            ],
            failedSpecs: [],
          },
        },
      }),
    );
    expect(qa).toEqual({ status: "evaluated", decision: "pass" });
  });

  it("follows the first-non-rejected preference, not assets[0]", () => {
    const qa = deriveQa(
      ugcJob({
        ugcPhase: "complete",
        ugcPhaseOutputs: {
          production: {
            assets: [
              {
                approvalState: "rejected",
                qaMetrics: { ...evaluatedPass, overallDecision: "fail" },
                outputs: { videoUrl: "https://c.example/b.mp4" },
              },
              {
                approvalState: "approved",
                qaMetrics: evaluatedPass,
                outputs: { videoUrl: "https://c.example/g.mp4" },
              },
            ],
            failedSpecs: [],
          },
        },
      }),
    );
    expect(qa).toEqual({ status: "evaluated", decision: "pass" });
  });

  it("absent for polished jobs", () => {
    expect(deriveQa(job({ currentStage: "complete" }))).toBeUndefined();
  });

  it("absent when qaMetrics is unparseable", () => {
    const qa = deriveQa(
      ugcJob({
        ugcPhase: "complete",
        ugcPhaseOutputs: {
          production: {
            assets: [
              {
                approvalState: "approved",
                qaMetrics: { garbage: true },
                outputs: { videoUrl: "https://c.example/g.mp4" },
              },
            ],
            failedSpecs: [],
          },
        },
      }),
    );
    expect(qa).toBeUndefined();
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
