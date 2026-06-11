import { describe, it, expect, vi } from "vitest";
import { runStage } from "../run-stage.js";
import type { StageInput } from "../run-stage.js";

// Mock the video producer module
vi.mock("../video-producer.js", () => ({
  runVideoProducer: vi.fn().mockResolvedValue({
    tier: "basic",
    clips: [
      {
        sceneRef: "s0-scene-1",
        videoUrl: "https://kling/v.mp4",
        duration: 5,
        generatedBy: "kling",
      },
    ],
  }),
  createPromptOptimizer: vi.fn().mockReturnValue(vi.fn()),
}));

// run-stage no longer constructs KlingClient (it uses the injected client). This
// mock exists only so a test can assert the constructor is NEVER called: a
// regression to a self-built empty-key client would trip it.
vi.mock("../kling-client.js", () => ({
  KlingClient: vi.fn(),
}));

vi.mock("../elevenlabs-client.js", () => ({
  ElevenLabsClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../whisper-client.js", () => ({
  WhisperClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../video-assembler.js", () => ({
  VideoAssembler: vi.fn().mockImplementation(() => ({})),
}));

const baseProductionInput: StageInput = {
  jobId: "job-1",
  brief: {
    productDescription: "Widget",
    targetAudience: "Everyone",
    platforms: ["meta"],
  },
  previousOutputs: {
    storyboard: {
      storyboards: [
        {
          scriptRef: "s0",
          scenes: [
            {
              sceneNumber: 1,
              description: "Intro",
              visualDirection: "zoom",
              duration: 5,
              textOverlay: null,
              referenceImageUrl: null,
            },
          ],
        },
      ],
    },
    scripts: {
      scripts: [
        {
          hookRef: "h0",
          fullScript: "Test script",
          timing: [],
          format: "feed_video",
          platform: "meta",
          productionNotes: "",
        },
      ],
    },
  },
  apiKey: "test-key",
  productionTier: "basic",
  klingClient: { generateVideo: vi.fn() },
};

describe("runStage — production", () => {
  it("calls runVideoProducer for production stage", async () => {
    const result = await runStage("production", baseProductionInput);
    expect((result as Record<string, unknown>).tier).toBe("basic");
    expect((result as Record<string, unknown>).clips).toBeDefined();
  });

  it("forwards assetStorage + jobId to runVideoProducer for production", async () => {
    const { runVideoProducer } = await import("../video-producer.js");
    const mockProducer = runVideoProducer as ReturnType<typeof vi.fn>;
    mockProducer.mockClear();

    const assetStorage = { upload: vi.fn() };
    await runStage("production", { ...baseProductionInput, assetStorage });

    expect(mockProducer).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1" }),
      expect.objectContaining({ assetStorage }),
    );
  });

  it("throws when no klingClient is injected (KLING_API_KEY unset at bootstrap)", async () => {
    const { klingClient: _omit, ...withoutClient } = baseProductionInput;
    await expect(runStage("production", withoutClient)).rejects.toThrow(/not configured/);
  });

  it("forwards the injected klingClient to runVideoProducer (no self-built client)", async () => {
    const { runVideoProducer } = await import("../video-producer.js");
    const mockProducer = runVideoProducer as ReturnType<typeof vi.fn>;
    mockProducer.mockClear();

    const klingClient = { generateVideo: vi.fn() };
    await runStage("production", { ...baseProductionInput, klingClient });

    expect(mockProducer).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1" }),
      expect.objectContaining({ klingClient }),
    );
  });

  it("does not construct its own KlingClient (uses only the injected one)", async () => {
    const { KlingClient } = await import("../kling-client.js");
    (KlingClient as unknown as ReturnType<typeof vi.fn>).mockClear();

    const klingClient = { generateVideo: vi.fn() };
    await runStage("production", { ...baseProductionInput, klingClient });

    expect(KlingClient).not.toHaveBeenCalled();
  });
});
