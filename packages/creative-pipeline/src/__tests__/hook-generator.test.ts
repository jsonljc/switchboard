// packages/core/src/creative-pipeline/__tests__/hook-generator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runHookGenerator, buildHookPrompt } from "../stages/hook-generator.js";
import type { HookGeneratorOutput, TrendAnalysisOutput } from "@switchboard/schemas";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

const mockTrendOutput: TrendAnalysisOutput = {
  angles: [
    {
      theme: "Time savings",
      motivator: "Reduce no-shows",
      platformFit: "meta",
      rationale: "Problem-aware audience",
    },
  ],
  audienceInsights: {
    awarenessLevel: "problem_aware",
    topDrivers: ["time savings"],
    objections: ["cost"],
  },
  trendSignals: [{ platform: "meta", trend: "UGC style", relevance: "High" }],
};

describe("buildHookPrompt", () => {
  it("includes platform-specific rules and angles from Stage 1", () => {
    const { systemPrompt, userMessage } = buildHookPrompt(
      { productDescription: "AI tool", targetAudience: "SMBs", platforms: ["meta", "tiktok"] },
      mockTrendOutput,
    );

    expect(systemPrompt).toContain("hook copywriter");
    expect(systemPrompt).toContain("Pattern interrupt");
    expect(systemPrompt).toContain("Meta cold");
    expect(systemPrompt).toContain("TikTok");
    expect(userMessage).toContain("Time savings");
  });
});

describe("runHookGenerator", () => {
  const mockOutput: HookGeneratorOutput = {
    hooks: [
      {
        angleRef: "0",
        text: "Still losing 30% of bookings to no-shows?",
        type: "question",
        platformScore: 8,
        rationale: "Question hooks perform well for problem-aware Meta audiences",
      },
    ],
    topCombos: [{ angleRef: "0", hookRef: "0", score: 8 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Claude with trend output and returns validated hooks", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockOutput);

    const result = await runHookGenerator(
      { productDescription: "AI tool", targetAudience: "SMBs", platforms: ["meta"] },
      mockTrendOutput,
      "test-api-key",
    );

    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]?.type).toBe("question");
    expect(result.topCombos).toHaveLength(1);

    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        systemPrompt: expect.stringContaining("hook copywriter"),
      }),
    );
  });
});
