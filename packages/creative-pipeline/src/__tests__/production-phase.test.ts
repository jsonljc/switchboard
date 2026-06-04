import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeProductionPhase, type ProductionInput } from "../ugc/phases/production.js";
import { buildFrameQaDeps } from "../ugc/frame-qa-deps.js";

// The frame-QA deps factory is module-mocked: by default it returns undefined,
// so evaluateRealism stays the honest stub (requires_human_review) and the
// legacy tests keep their no-QA semantics. Slice-3 tests program it per case.
vi.mock("../ugc/frame-qa-deps.js", () => ({
  buildFrameQaDeps: vi.fn(),
}));

function fakeQaDeps(visionResults: Array<Record<string, unknown>>) {
  let call = 0;
  return {
    frameExtractor: {
      extract: vi
        .fn()
        .mockResolvedValue({ frames: ["QUJD"], localVideoPath: "/tmp/src.mp4", workDir: "/tmp" }),
    },
    vision: vi.fn().mockImplementation(async () => {
      const result = visionResults[Math.min(call, visionResults.length - 1)]!;
      call++;
      return result;
    }),
  };
}

const CLEAN_VISION = {
  artifactFlags: [],
  humanPresent: true,
  softScores: { visualRealism: 0.8, behavioralRealism: 0.8, ugcAuthenticity: 0.8 },
};
const BROKEN_VISION = {
  artifactFlags: ["broken_frame"],
  humanPresent: true,
  softScores: { visualRealism: 0.2, behavioralRealism: 0.2, ugcAuthenticity: 0.2 },
};

function createMockDeps() {
  return {
    providerClients: {
      klingClient: {
        generateVideo: vi.fn().mockResolvedValue({
          videoUrl: "https://cdn.example.com/generated.mp4",
          duration: 15,
        }),
      },
    },
    assetStore: {
      upsertByKey: vi.fn().mockImplementation((input: Record<string, unknown>) => ({
        id: `asset_${input.specId}_${input.attemptNumber}`,
        ...input,
        createdAt: new Date(),
      })),
      findLockedByCreator: vi.fn().mockResolvedValue(null),
    },
    apiKey: "test-key",
  };
}

function makeSpec(id: string, overrides: Record<string, unknown> = {}) {
  return {
    specId: id,
    deploymentId: "dep_1",
    mode: "ugc" as const,
    creatorId: "cr_1",
    structureId: "confession",
    motivator: "general",
    platform: "meta_feed",
    script: { text: "Hey so...", language: "en" },
    style: {},
    direction: {},
    format: "product_demo",
    identityConstraints: { strategy: "reference_conditioning", maxIdentityDrift: 0.5 },
    renderTargets: { aspect: "9:16", durationSec: 15 },
    qaThresholds: { faceSimilarityMin: 0.7, realismMin: 0.5 },
    providersAllowed: ["kling"],
    campaignTags: {},
    ...overrides,
  };
}

describe("executeProductionPhase", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks clears CALLS, not implementations: a prior test's
    // mockReturnValue(qaDeps) would otherwise leak across tests. Default to
    // the no-deps honest stub; QA tests override per case.
    (buildFrameQaDeps as ReturnType<typeof vi.fn>).mockReset();
    deps = createMockDeps();
  });

  it("produces assets for each spec", async () => {
    const input: ProductionInput = {
      specs: [makeSpec("spec_1"), makeSpec("spec_2")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets.length).toBe(2);
    expect(result.failedSpecs).toHaveLength(0);
  });

  it("persists every produced asset as requires_human_review — QA never auto-approves an unseen video", async () => {
    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets[0]!.approvalState).toBe("requires_human_review");
  });

  it("retries on generation error, then succeeds", async () => {
    deps.providerClients.klingClient.generateVideo
      .mockRejectedValueOnce(new Error("provider 500"))
      .mockResolvedValueOnce({ videoUrl: "https://cdn.example.com/ok.mp4", duration: 15 });

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets.length).toBe(1);
    expect(deps.providerClients.klingClient.generateVideo).toHaveBeenCalledTimes(2);
  });

  it("reports failed spec when generation errors exhaust all attempts", async () => {
    deps.providerClients.klingClient.generateVideo.mockRejectedValue(new Error("provider down"));

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 2, maxProviderFallbacks: 0 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets).toHaveLength(0);
    expect(result.failedSpecs).toHaveLength(1);
    expect(result.failedSpecs[0]!.specId).toBe("spec_1");
  });

  it("falls back to asset reuse when generation errors exhaust attempts", async () => {
    deps.providerClients.klingClient.generateVideo.mockRejectedValue(new Error("provider down"));

    const reusableAsset = {
      id: "existing_asset",
      specId: "old_spec",
      approvalState: "locked",
      provider: "kling",
      modelId: "kling-v1",
      inputHashes: {},
      outputs: { videoUrl: "https://cdn.example.com/reuse.mp4", checksums: {} },
    };
    deps.assetStore.findLockedByCreator.mockResolvedValue(reusableAsset);

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 1, maxProviderFallbacks: 0 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets.length).toBe(1);
    expect(result.assets[0]!.lockedDerivativeOf).toBe("existing_asset");
  });

  it("persists assets via upsertByKey", async () => {
    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    await executeProductionPhase(input);
    expect(deps.assetStore.upsertByKey).toHaveBeenCalled();
    const firstCall = deps.assetStore.upsertByKey.mock.calls[0]![0];
    expect(firstCall).toMatchObject({ specId: "spec_1", attemptNumber: 1 });
  });

  // ── Slice-3 frame QA (spec 3.1): live wiring, retry-on-fail, budget ──

  it("wires frame-qa deps from the phase apiKey into the evaluator (never silently the stub)", async () => {
    const qa = fakeQaDeps([CLEAN_VISION]);
    (buildFrameQaDeps as ReturnType<typeof vi.fn>).mockReturnValue(qa);

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(buildFrameQaDeps).toHaveBeenCalledWith("test-key");
    expect(qa.vision).toHaveBeenCalledTimes(1);
    // evaluated + pass auto-approves through deriveApprovalState
    expect(result.assets[0]!.approvalState).toBe("approved");
  });

  it("retries a qa-fail verdict and persists EVERY attempt row", async () => {
    const qa = fakeQaDeps([BROKEN_VISION, CLEAN_VISION]);
    (buildFrameQaDeps as ReturnType<typeof vi.fn>).mockReturnValue(qa);

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);

    expect(deps.providerClients.klingClient.generateVideo).toHaveBeenCalledTimes(2);
    expect(deps.assetStore.upsertByKey).toHaveBeenCalledTimes(2);
    const persisted = deps.assetStore.upsertByKey.mock.calls.map((c) => c[0]);
    expect(persisted[0]).toMatchObject({ attemptNumber: 1, approvalState: "rejected" });
    expect(persisted[1]).toMatchObject({ attemptNumber: 2, approvalState: "approved" });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.approvalState).toBe("approved");
    expect(result.failedSpecs).toHaveLength(0);
    expect(result.qaResults["spec_1"]).toHaveLength(2);
  });

  it("exhausted qa-fails return the LAST rejected asset plus a qa_failed entry", async () => {
    const qa = fakeQaDeps([BROKEN_VISION]);
    (buildFrameQaDeps as ReturnType<typeof vi.fn>).mockReturnValue(qa);

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 2, maxProviderFallbacks: 0 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);

    expect(deps.assetStore.upsertByKey).toHaveBeenCalledTimes(2);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.approvalState).toBe("rejected");
    expect(result.assets[0]!.attemptNumber).toBe(2);
    expect(result.failedSpecs).toEqual([{ specId: "spec_1", reason: "qa_failed" }]);
    // garbage renders never fall back to unrelated reuse assets
    expect(deps.assetStore.findLockedByCreator).not.toHaveBeenCalled();
  });

  // ── Slice-3 prompt fidelity + providersAllowed (spec 3.2) ──

  it("generates with the composed direction-faithful request, not raw script text", async () => {
    const styled = makeSpec("spec_1", {
      style: {
        lighting: "golden_hour",
        cameraAngle: "selfie",
        cameraMovement: "slow_pan",
        environment: "bright clinic interior",
        wardrobeSelection: ["soft neutrals"],
        hairState: "natural",
        props: [],
      },
      direction: {
        hookType: "direct_camera",
        eyeContact: "camera",
        energyLevel: "medium",
        pacingNotes: "Match conversational delivery style",
        imperfections: {
          hesitationDensity: 0.15,
          sentenceRestartRate: 0.1,
          microPauseDensity: 0.2,
          fillerDensityTarget: 0.2,
          fragmentationTarget: 0.3,
        },
        adLibPermissions: [],
        forbiddenFraming: ["no studio lighting"],
      },
    });
    const input: ProductionInput = {
      specs: [styled],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    await executeProductionPhase(input);
    const req = deps.providerClients.klingClient.generateVideo.mock.calls[0]![0];
    expect(req.prompt).toContain("Hey so...");
    expect(req.prompt).toContain("golden hour lighting");
    expect(req.negativePrompt).toContain("no studio lighting");
    expect(req.cameraMotion).toBe("pan_right");
  });

  it("honors providersAllowed: a kling-only talking_head spec never burns heygen attempts", async () => {
    // talking_head ranks heygen above kling (audio-driven bonus); the filter
    // must keep the throwing heygen adapter out entirely.
    const spec = makeSpec("spec_1", { format: "talking_head" });
    const input: ProductionInput = {
      specs: [spec],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.attemptNumber).toBe(1);
    expect(result.assets[0]!.provider).toBe("kling");
  });

  it("fails a spec loudly when no ranked provider is allowed", async () => {
    const spec = makeSpec("spec_1", { providersAllowed: ["nonexistent"] });
    const input: ProductionInput = {
      specs: [spec],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets).toHaveLength(0);
    expect(result.failedSpecs).toEqual([{ specId: "spec_1", reason: "no_allowed_provider" }]);
    expect(deps.providerClients.klingClient.generateVideo).not.toHaveBeenCalled();
  });

  it("budget accounting is attempt-accurate: qa-fail retries spend against the job budget", async () => {
    const qa = fakeQaDeps([BROKEN_VISION]);
    (buildFrameQaDeps as ReturnType<typeof vi.fn>).mockReturnValue(qa);

    // spec_1 burns 3 failing attempts (3 x 0.5 estimated kling cost = 1.5),
    // crossing the 1.0 budget BEFORE spec_2 starts.
    const input: ProductionInput = {
      specs: [makeSpec("spec_1"), makeSpec("spec_2")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 0 },
      budget: { totalJobBudget: 1.0, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);

    const reasons = result.failedSpecs.map((f) => `${f.specId}:${f.reason}`);
    expect(reasons).toContain("spec_1:qa_failed");
    expect(reasons).toContain("spec_2:budget exceeded");
    // spec_2 never generated
    expect(deps.providerClients.klingClient.generateVideo).toHaveBeenCalledTimes(3);
  });
});
