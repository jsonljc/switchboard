import { describe, it, expect, vi } from "vitest";
import { evaluateMinimalQa } from "../ugc/minimal-qa.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

describe("evaluateMinimalQa", () => {
  it("does NOT call the LLM to 'score' a video it cannot see", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockClear();
    await evaluateMinimalQa({
      videoUrl: "https://cdn.example.com/video.mp4",
      specDescription: "Talking head confession ad",
      apiKey: "test-key",
    });
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("reports requires_human_review and never auto-passes (no real evaluation)", async () => {
    const result = await evaluateMinimalQa({
      videoUrl: "https://cdn.example.com/video.mp4",
      specDescription: "Talking head ad",
      apiKey: "test-key",
    });
    expect(result.qaStatus).toBe("requires_human_review");
    expect(result.overallDecision).not.toBe("pass");
  });
});
