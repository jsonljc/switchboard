import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeProductionPhase, type ProductionInput } from "../ugc/phases/production.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    faceSimilarity: 0.9,
    ocrAccuracy: 0.95,
    artifactFlags: [],
    visualRealism: 0.8,
    behavioralRealism: 0.8,
    ugcAuthenticity: 0.85,
    audioNaturalness: 0.75,
  }),
}));

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
    format: "product_demo", // Use product_demo instead of talking_head to avoid heygen bonus
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

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset callClaude mock to default passing scores
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue({
      faceSimilarity: 0.9,
      ocrAccuracy: 0.95,
      artifactFlags: [],
      visualRealism: 0.8,
      behavioralRealism: 0.8,
      ugcAuthenticity: 0.85,
      audioNaturalness: 0.75,
    });
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

  it("retries on QA failure", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockClaude = callClaude as ReturnType<typeof vi.fn>;
    mockClaude
      .mockResolvedValueOnce({
        faceSimilarity: 0.3, // below 0.7 threshold → fail
        ocrAccuracy: 0.9,
        artifactFlags: ["face_drift"],
        visualRealism: 0.3,
        behavioralRealism: 0.3,
        ugcAuthenticity: 0.3,
        audioNaturalness: 0.3,
      })
      .mockResolvedValueOnce({
        faceSimilarity: 0.9,
        ocrAccuracy: 0.95,
        artifactFlags: [],
        visualRealism: 0.8,
        behavioralRealism: 0.8,
        ugcAuthenticity: 0.85,
        audioNaturalness: 0.75,
      });

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets.length).toBe(1);
    // Should have generated twice (first fail, then pass)
    expect(deps.providerClients.klingClient.generateVideo).toHaveBeenCalledTimes(2);
  });

  it("reports failed spec when all attempts exhausted", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockClaude = callClaude as ReturnType<typeof vi.fn>;
    mockClaude.mockResolvedValue({
      faceSimilarity: 0.3, // below 0.7 threshold → fail
      ocrAccuracy: 0.9,
      artifactFlags: ["face_drift"],
      visualRealism: 0.3,
      behavioralRealism: 0.3,
      ugcAuthenticity: 0.3,
      audioNaturalness: 0.3,
    });

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
    expect(result.failedSpecs[0].specId).toBe("spec_1");
  });

  it("falls back to asset reuse when generation exhausted", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue({
      faceSimilarity: 0.3, // below 0.7 threshold → fail
      ocrAccuracy: 0.9,
      artifactFlags: [],
      visualRealism: 0.3,
      behavioralRealism: 0.3,
      ugcAuthenticity: 0.3,
      audioNaturalness: 0.3,
    });

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
    expect(result.assets[0].lockedDerivativeOf).toBe("existing_asset");
  });

  it("triggers circuit breaker after repeated failures", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue({
      faceSimilarity: 0.3, // below 0.7 threshold → fail
      ocrAccuracy: 0.9,
      artifactFlags: [],
      visualRealism: 0.3,
      behavioralRealism: 0.3,
      ugcAuthenticity: 0.3,
      audioNaturalness: 0.3,
    });

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 5, maxProviderFallbacks: 0 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    // Should stop before all 5 attempts due to circuit breaker (triggers at 3 failures with 80%+ fail rate)
    expect(deps.providerClients.klingClient.generateVideo.mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.failedSpecs.length).toBe(1);
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
    const firstCall = deps.assetStore.upsertByKey.mock.calls[0][0];
    expect(firstCall).toMatchObject({
      specId: "spec_1",
      attemptNumber: 1,
    });
  });
});
