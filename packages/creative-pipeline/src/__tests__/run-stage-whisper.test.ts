// Pins the PR-0 truth fix (spec 3.6, slice-3 design): the Whisper client must be
// constructed with the OPENAI key, and only when one is configured. Before this
// fix the production stage handed it the Anthropic key, so every pro-tier
// captions call 401'd against api.openai.com (silently, into the errors array).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runStage } from "../stages/run-stage.js";
import { WhisperClient } from "../stages/whisper-client.js";
import type { ScriptWriterOutput, StoryboardOutput } from "@switchboard/schemas";

vi.mock("../stages/whisper-client.js", () => ({
  WhisperClient: vi.fn().mockImplementation(() => ({ transcribe: vi.fn() })),
}));
vi.mock("../stages/elevenlabs-client.js", () => ({
  ElevenLabsClient: vi.fn().mockImplementation(() => ({ synthesize: vi.fn() })),
}));
vi.mock("../stages/video-assembler.js", () => ({
  VideoAssembler: vi.fn().mockImplementation(() => ({ assemble: vi.fn() })),
}));
vi.mock("../stages/video-producer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stages/video-producer.js")>();
  return {
    ...actual,
    runVideoProducer: vi.fn().mockResolvedValue({ tier: "pro", clips: [] }),
    createPromptOptimizer: vi.fn().mockReturnValue(vi.fn()),
  };
});

const scripts: ScriptWriterOutput = {
  scripts: [
    {
      hookRef: "0",
      fullScript: "Script text",
      timing: [{ section: "hook", startSec: 0, endSec: 3, content: "Hook" }],
      format: "feed_video",
      platform: "meta",
      productionNotes: "Notes",
    },
  ],
};

const storyboard: StoryboardOutput = {
  storyboards: [
    {
      scriptRef: "0",
      scenes: [
        {
          sceneNumber: 1,
          description: "Scene 1",
          visualDirection: "Close-up",
          duration: 3,
          textOverlay: null,
          referenceImageUrl: null,
        },
      ],
    },
  ],
};

const baseInput = {
  jobId: "job_1",
  brief: {
    productDescription: "AI tool",
    targetAudience: "SMBs",
    platforms: ["meta"] as string[],
    brandVoice: null,
  },
  previousOutputs: { storyboard, scripts } as Record<string, unknown>,
  apiKey: "anthropic-key",
  productionTier: "pro",
  klingClient: { generateVideo: vi.fn() },
};

describe("run-stage production whisper key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pro tier without openaiApiKey constructs no whisper client (no anthropic-key 401s)", async () => {
    await runStage("production", baseInput);
    expect(WhisperClient).not.toHaveBeenCalled();
  });

  it("pro tier with openaiApiKey constructs whisper with THAT key", async () => {
    await runStage("production", { ...baseInput, openaiApiKey: "sk-oai" });
    expect(WhisperClient).toHaveBeenCalledWith({ apiKey: "sk-oai" });
  });
});
