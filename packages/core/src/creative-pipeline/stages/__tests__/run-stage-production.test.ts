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

vi.mock("../kling-client.js", () => ({
  KlingClient: vi.fn().mockImplementation(() => ({})),
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

describe("runStage — production", () => {
  it("calls runVideoProducer for production stage", async () => {
    const input: StageInput = {
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
    };

    const result = await runStage("production", input);
    expect((result as Record<string, unknown>).tier).toBe("basic");
    expect((result as Record<string, unknown>).clips).toBeDefined();
  });
});
