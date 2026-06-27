import { describe, it, expect } from "vitest";
import type { CreativeJob } from "@switchboard/schemas";
import { mapCreativeJobToMiraStatus } from "../status-mapper.js";

// SPINE-9 regression guard: a CreativeJob carries TWO lifecycle axes —
// polished keys off `currentStage`/`stageOutputs`, UGC keys off
// `ugcPhase`/`ugcPhaseOutputs`. The mapper branches on `mode` FIRST, so a stale
// value on the OTHER axis must never leak into the read status. These cases pin
// that isolation in both directions so a future refactor that checks
// `currentStage` (or `ugcPhase`) before the mode branch is caught.
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

describe("dual-lifecycle currentStage/ugcPhase isolation (SPINE-9)", () => {
  it("UGC-complete reads draft_ready despite a stale non-terminal currentStage", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          mode: "ugc",
          currentStage: "hooks",
          ugcPhase: "complete",
          ugcPhaseOutputs: { production: {} },
        }),
      ),
    ).toBe("draft_ready");
  });

  it("UGC-incomplete does NOT inherit a stale currentStage='complete'", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          mode: "ugc",
          currentStage: "complete",
          ugcPhase: "planning",
          ugcPhaseOutputs: null,
        }),
      ),
    ).toBe("in_progress");
  });

  it("polished-complete reads draft_ready despite a stale ugcPhase value", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          mode: "polished",
          currentStage: "complete",
          ugcPhase: "complete" as never,
          stageOutputs: { production: {} },
        }),
      ),
    ).toBe("draft_ready");
  });

  it("polished-incomplete does NOT inherit a stale ugcPhase='complete'", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          mode: "polished",
          currentStage: "trends",
          ugcPhase: "complete" as never,
          stageOutputs: {},
        }),
      ),
    ).toBe("in_progress");
  });
});
