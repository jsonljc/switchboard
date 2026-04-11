// packages/core/src/creative-pipeline/__tests__/trend-analyzer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTrendAnalyzer, buildTrendPrompt } from "../stages/trend-analyzer.js";
import type { TrendAnalysisOutput } from "@switchboard/schemas";

// Mock the callClaude helper
vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

describe("buildTrendPrompt", () => {
  it("includes product description and target audience", () => {
    const { systemPrompt, userMessage } = buildTrendPrompt({
      productDescription: "AI scheduling tool for salons",
      targetAudience: "Salon owners aged 30-50",
      platforms: ["meta", "tiktok"],
    });

    expect(systemPrompt).toContain("performance creative strategist");
    expect(systemPrompt).toContain("awarenessLevel");
    expect(userMessage).toContain("AI scheduling tool for salons");
    expect(userMessage).toContain("Salon owners aged 30-50");
    expect(userMessage).toContain("meta");
    expect(userMessage).toContain("tiktok");
  });
});

describe("runTrendAnalyzer", () => {
  const mockOutput: TrendAnalysisOutput = {
    angles: [
      {
        theme: "Time savings",
        motivator: "Reduce no-shows by 60%",
        platformFit: "meta",
        rationale: "Problem-aware audience responds to quantified benefits",
      },
    ],
    audienceInsights: {
      awarenessLevel: "problem_aware",
      topDrivers: ["time savings", "reduced no-shows"],
      objections: ["cost", "learning curve"],
    },
    trendSignals: [
      { platform: "meta", trend: "Before/after transformations", relevance: "High visual impact" },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Claude and returns validated trend analysis", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockOutput);

    const result = await runTrendAnalyzer(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "Salon owners",
        platforms: ["meta"],
      },
      "test-api-key",
    );

    expect(result.angles).toHaveLength(1);
    expect(result.angles[0]?.theme).toBe("Time savings");
    expect(result.audienceInsights.awarenessLevel).toBe("problem_aware");
    expect(result.trendSignals).toHaveLength(1);

    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        systemPrompt: expect.stringContaining("performance creative strategist"),
        userMessage: expect.stringContaining("AI scheduling tool"),
      }),
    );
  });
});
