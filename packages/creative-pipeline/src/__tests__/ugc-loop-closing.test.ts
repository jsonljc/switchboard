// Slice-3 loop-closing proof (spec 3.3): the six reachability fixes COMPOSE.
// The REAL pipeline runs end to end over the EXACT UgcConfig shape the fixed
// submit workflow persists (UgcConfigSchema-parsed), with a creator present,
// approvals resolved by decision-workflow-SHAPED events (phase = persisted
// NEXT phase, the payload that used to never match), and only the external
// edges mocked (Claude script call, Kling render, frame-QA deps, storage).
//
// Asserts the bug classes this slice closes:
//   (d) the brief the SCRIPT WRITER receives carries the submitted
//       productDescription (the empty-brief class),
//   (a) decision-workflow-shaped approves RESUME the pipeline to completion,
//   (e) a creator yields specs (no silent zero-asset completion),
//   (f) the final asset uploads durably and the job gains durableAssetUrl.
// The api suite tiles the rest: submit persists this exact shape, the guard,
// the spend producer + real governance gate, and the read model.
import { describe, it, expect, vi } from "vitest";
import { UgcConfigSchema } from "@switchboard/schemas";

const { callClaudeSpy } = vi.hoisted(() => ({
  callClaudeSpy: vi.fn(),
}));
vi.mock("../stages/call-claude.js", () => ({
  callClaude: callClaudeSpy,
  callClaudeWithImages: vi.fn(),
}));
vi.mock("../ugc/frame-qa-deps.js", () => ({
  buildFrameQaDeps: vi.fn(() => ({
    frameExtractor: {
      extract: vi
        .fn()
        .mockResolvedValue({ frames: ["QUJD"], localVideoPath: "/tmp/s.mp4", workDir: "/tmp/w" }),
    },
    vision: vi.fn().mockResolvedValue({
      artifactFlags: [],
      humanPresent: true,
      softScores: { visualRealism: 0.8, behavioralRealism: 0.8, ugcAuthenticity: 0.8 },
    }),
  })),
}));
vi.mock("../ugc/video-download.js", () => ({
  downloadVideoToTmp: vi.fn(async () => ({ localPath: "/tmp/dl.mp4", cleanup: vi.fn() })),
}));
vi.mock("../inngest-client.js", () => ({
  inngestClient: { createFunction: vi.fn(), schemas: new Map() },
}));

import { executeUgcPipeline } from "../ugc/ugc-job-runner.js";

const SUBMITTED_BRIEF = {
  productDescription: "Botox first-timer offer",
  targetAudience: "women 30-45",
  platforms: ["meta"],
  brandVoice: null,
  productImages: [],
  references: [],
  pastPerformance: null,
  generateReferenceImages: false,
};

// The EXACT construction the fixed submit workflow performs (spec 3.3d).
const ugcConfig = UgcConfigSchema.parse({
  brief: { ...SUBMITTED_BRIEF, ugcFormat: "talking_head", creatorPoolIds: [] },
});

const houseCreator = {
  id: "creator_house",
  name: "House Creator",
  identityRefIds: [],
  heroImageAssetId: "house_creator_placeholder",
  voice: { voiceId: "v1", provider: "elevenlabs", tone: "warm", pace: "moderate", sampleUrl: "" },
  personality: { energy: "conversational", deliveryStyle: "natural" },
  appearanceRules: { hairStates: ["natural"], wardrobePalette: ["soft neutrals"] },
  environmentSet: ["bright clinic interior"],
};

describe("ugc loop-closing (slice-3 spec 3.3)", () => {
  it("runs the REAL pipeline from the persisted UgcConfig to a durable completed draft", async () => {
    callClaudeSpy.mockResolvedValue({
      text: "Hey, quick story about my first botox visit.",
      language: "en",
    });

    const job = {
      id: "job_loop",
      deploymentId: "dep_1",
      mode: "ugc",
      ugcPhase: null,
      ugcPhaseOutputs: null,
      ugcConfig,
    };

    const savedPhases: Array<{ phase: string; outputs: Record<string, unknown> }> = [];
    const setDurableAsset = vi.fn();
    const deps = {
      jobStore: {
        findById: vi.fn().mockResolvedValue(job),
        updateUgcPhase: vi.fn(async (_o: string, _id: string, phase: string, outputs: never) => {
          savedPhases.push({ phase, outputs });
          return job;
        }),
        stopUgc: vi.fn(),
        failUgc: vi.fn(),
        setDurableAsset,
      },
      creatorStore: { findByDeployment: vi.fn().mockResolvedValue([houseCreator]) },
      deploymentStore: {
        findById: vi.fn().mockResolvedValue({ listing: { trustScore: 0 }, type: "standard" }),
      },
      llmConfig: { apiKey: "anthropic-key" },
      klingClient: {
        generateVideo: vi
          .fn()
          .mockResolvedValue({ videoUrl: "https://cdn.kling.example/clip.mp4", duration: 10 }),
      },
      assetStore: {
        upsertByKey: vi.fn(async (input: Record<string, unknown>) => input),
        findLockedByCreator: vi.fn().mockResolvedValue(null),
      },
      assetStorage: {
        upload: vi.fn(async ({ key }: { key: string }) => ({
          url: `https://durable.example.com/${key}`,
        })),
      },
    };

    // Approvals arrive exactly as the decision workflow emits them: phase =
    // the PERSISTED (next) phase. Under the old phase-filtered wait none of
    // these would ever match; jobId-only matching (3.3a) resumes each gate.
    const step = {
      run: vi.fn((_name: string, fn: () => unknown) => fn()),
      waitForEvent: vi.fn(async () => ({
        data: { action: "continue", phase: savedPhases.at(-1)?.phase ?? "unknown" },
      })),
      sendEvent: vi.fn(),
    };

    await executeUgcPipeline(
      { jobId: "job_loop", taskId: "t1", organizationId: "org_1", deploymentId: "dep_1" },
      step as never,
      deps as never,
    );

    // (d) the script writer was driven by the SUBMITTED brief, not an empty one
    const scriptPrompt = JSON.stringify(callClaudeSpy.mock.calls[0]![0]);
    expect(scriptPrompt).toContain("Botox first-timer offer");

    // (e) a creator yields real specs through planning -> scripting
    const scripting = savedPhases.find((s) => s.outputs["scripting"])!.outputs["scripting"] as {
      specs: Array<Record<string, unknown>>;
    };
    expect(scripting.specs.length).toBeGreaterThan(0);
    expect(scripting.specs[0]!.style).toBeDefined();
    expect(scripting.specs[0]!.direction).toBeDefined();

    // (a) every gate resumed (4 waits at trust 0), nothing stopped or failed
    expect(step.waitForEvent).toHaveBeenCalledTimes(4);
    expect(deps.jobStore.stopUgc).not.toHaveBeenCalled();
    expect(deps.jobStore.failUgc).not.toHaveBeenCalled();

    // pipeline reached complete
    expect(savedPhases.at(-1)!.phase).toBe("complete");

    // (f) the final asset is durable and promoted to the job
    expect(deps.assetStorage.upload).toHaveBeenCalledTimes(1);
    expect(setDurableAsset).toHaveBeenCalledWith(
      "org_1",
      "job_loop",
      expect.stringContaining("https://durable.example.com/creative-assets/job_loop/ugc-"),
    );

    // the completed event reports the produced asset
    expect(step.sendEvent).toHaveBeenCalledWith(
      "emit-completed",
      expect.objectContaining({
        data: expect.objectContaining({ assetsProduced: 1, failed: 0 }),
      }),
    );
  });
});
