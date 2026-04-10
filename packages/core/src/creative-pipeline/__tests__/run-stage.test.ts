// packages/core/src/creative-pipeline/__tests__/run-stage.test.ts
import { describe, it, expect, vi } from "vitest";
import { runStage, getNextStage } from "../stages/run-stage.js";
import type {
  TrendAnalysisOutput,
  HookGeneratorOutput,
  ScriptWriterOutput,
} from "@switchboard/schemas";

// Mock callClaude so stages 1-3 don't hit real API
vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

const baseBrief = {
  productDescription: "AI tool",
  targetAudience: "SMBs",
  platforms: ["meta"] as string[],
  brandVoice: null,
};

const baseInput = {
  jobId: "job_1",
  brief: baseBrief,
  previousOutputs: {} as Record<string, unknown>,
  apiKey: "test-key",
};

const mockTrendsOutput: TrendAnalysisOutput = {
  angles: [{ theme: "T", motivator: "M", platformFit: "meta", rationale: "R" }],
  audienceInsights: {
    awarenessLevel: "problem_aware",
    topDrivers: ["d"],
    objections: ["o"],
  },
  trendSignals: [{ platform: "meta", trend: "t", relevance: "r" }],
};

const mockHooksOutput: HookGeneratorOutput = {
  hooks: [{ angleRef: "0", text: "Hook", type: "question", platformScore: 8, rationale: "R" }],
  topCombos: [{ angleRef: "0", hookRef: "0", score: 8 }],
};

const mockScriptsOutput: ScriptWriterOutput = {
  scripts: [
    {
      hookRef: "0",
      fullScript: "Script text",
      timing: [
        { section: "hook", startSec: 0, endSec: 3, content: "Stop scrolling" },
        { section: "problem", startSec: 3, endSec: 8, content: "Problem" },
        { section: "solution", startSec: 8, endSec: 18, content: "Solution" },
        { section: "proof", startSec: 18, endSec: 25, content: "Proof" },
        { section: "cta", startSec: 25, endSec: 30, content: "CTA" },
      ],
      format: "feed_video",
      platform: "meta",
      productionNotes: "Notes",
    },
  ],
};

describe("runStage", () => {
  it("runs trends stage via Claude", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue(mockTrendsOutput);

    const result = await runStage("trends", baseInput);

    expect(result).toHaveProperty("angles");
    expect(result).toHaveProperty("audienceInsights");
    expect(result).toHaveProperty("trendSignals");
  });

  it("runs hooks stage via Claude with trends output", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue(mockHooksOutput);

    const result = await runStage("hooks", {
      ...baseInput,
      previousOutputs: { trends: mockTrendsOutput },
    });

    expect(result).toHaveProperty("hooks");
    expect(result).toHaveProperty("topCombos");
  });

  it("throws if hooks stage missing trends output", async () => {
    await expect(runStage("hooks", baseInput)).rejects.toThrow("requires trends output");
  });

  it("runs scripts stage via Claude with trends + hooks output", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue({
      scripts: [
        {
          hookRef: "0",
          fullScript: "Script",
          timing: [{ section: "hook", startSec: 0, endSec: 3, content: "Hook" }],
          format: "feed_video",
          platform: "meta",
          productionNotes: "Notes",
        },
      ],
    });

    const result = await runStage("scripts", {
      ...baseInput,
      previousOutputs: { trends: mockTrendsOutput, hooks: mockHooksOutput },
    });

    expect(result).toHaveProperty("scripts");
  });

  it("throws if scripts stage missing required outputs", async () => {
    await expect(runStage("scripts", baseInput)).rejects.toThrow(
      "requires trends and hooks output",
    );
  });

  it("runs storyboard stage via Claude with scripts output", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue({
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
    });

    const result = await runStage("storyboard", {
      ...baseInput,
      previousOutputs: { scripts: mockScriptsOutput },
    });

    expect(result).toHaveProperty("storyboards");
  });

  it("throws if storyboard stage missing scripts output", async () => {
    await expect(runStage("storyboard", baseInput)).rejects.toThrow("requires scripts output");
  });

  it("returns placeholder for production (SP5)", async () => {
    const result = await runStage("production", baseInput);
    expect(result).toHaveProperty("tier");
    expect(result).toHaveProperty("clips");
  });

  it("throws for unknown stage", async () => {
    await expect(runStage("unknown" as never, baseInput)).rejects.toThrow("Unknown stage: unknown");
  });
});

describe("getNextStage", () => {
  it("returns hooks after trends", () => expect(getNextStage("trends")).toBe("hooks"));
  it("returns scripts after hooks", () => expect(getNextStage("hooks")).toBe("scripts"));
  it("returns storyboard after scripts", () => expect(getNextStage("scripts")).toBe("storyboard"));
  it("returns complete after production", () =>
    expect(getNextStage("production")).toBe("complete"));
});
