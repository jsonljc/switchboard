import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeProductionPhase, type ProductionInput } from "../ugc/phases/production.js";

// NOTE: realism QA no longer calls an LLM (it cannot see the video), so there is
// no `call-claude` mock here. `evaluateRealism` returns `requires_human_review`
// for every generated asset; retry/fallback now keys on generation *errors* only.

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
});
