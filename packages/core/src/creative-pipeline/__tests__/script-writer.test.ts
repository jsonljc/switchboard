// packages/core/src/creative-pipeline/__tests__/script-writer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScriptWriter, buildScriptPrompt } from "../stages/script-writer.js";
import type {
  ScriptWriterOutput,
  TrendAnalysisOutput,
  HookGeneratorOutput,
} from "@switchboard/schemas";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

const mockTrendOutput: TrendAnalysisOutput = {
  angles: [
    {
      theme: "Time savings",
      motivator: "Reduce no-shows",
      platformFit: "meta",
      rationale: "Problem-aware",
    },
  ],
  audienceInsights: {
    awarenessLevel: "problem_aware",
    topDrivers: ["time savings"],
    objections: ["cost"],
  },
  trendSignals: [],
};

const mockHookOutput: HookGeneratorOutput = {
  hooks: [
    {
      angleRef: "0",
      text: "Still losing bookings to no-shows?",
      type: "question",
      platformScore: 8,
      rationale: "Question hooks work well for Meta",
    },
  ],
  topCombos: [{ angleRef: "0", hookRef: "0", score: 8 }],
};

describe("buildScriptPrompt", () => {
  it("includes timing structure and hooks from Stage 2", () => {
    const { systemPrompt, userMessage } = buildScriptPrompt(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
        brandVoice: "Professional but approachable",
      },
      mockTrendOutput,
      mockHookOutput,
    );

    expect(systemPrompt).toContain("scriptwriter");
    expect(systemPrompt).toContain("hook");
    expect(systemPrompt).toContain("timing");
    expect(userMessage).toContain("Still losing bookings");
    expect(userMessage).toContain("Professional but approachable");
  });

  it("handles null brand voice", () => {
    const { userMessage } = buildScriptPrompt(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
        brandVoice: null,
      },
      mockTrendOutput,
      mockHookOutput,
    );

    expect(userMessage).not.toContain("Brand Voice:");
  });
});

describe("runScriptWriter", () => {
  const mockOutput: ScriptWriterOutput = {
    scripts: [
      {
        hookRef: "0",
        fullScript:
          "[Hook] Still losing bookings to no-shows?\n[Problem] Every empty chair costs you $50...",
        timing: [
          { section: "hook", startSec: 0, endSec: 3, content: "Still losing bookings?" },
          { section: "problem", startSec: 3, endSec: 8, content: "Every empty chair costs $50" },
          { section: "solution", startSec: 8, endSec: 18, content: "AI scheduling reduces..." },
          { section: "proof", startSec: 18, endSec: 25, content: "500+ salons trust us" },
          { section: "cta", startSec: 25, endSec: 30, content: "Try free for 14 days" },
        ],
        format: "feed_video",
        platform: "meta",
        productionNotes: "Use before/after split screen for problem section",
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Claude with hooks and returns validated scripts", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockOutput);

    const result = await runScriptWriter(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
        brandVoice: null,
      },
      mockTrendOutput,
      mockHookOutput,
      "test-api-key",
    );

    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0]?.timing).toHaveLength(5);
    expect(result.scripts[0]?.format).toBe("feed_video");

    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        systemPrompt: expect.stringContaining("scriptwriter"),
      }),
    );
  });
});
