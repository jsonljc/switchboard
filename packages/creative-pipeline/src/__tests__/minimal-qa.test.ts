import { describe, it, expect, vi } from "vitest";
import { evaluateMinimalQa } from "../ugc/minimal-qa.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    decision: "pass",
    reasoning: "Video looks natural and authentic",
    artifactFlags: [],
  }),
}));

describe("evaluateMinimalQa", () => {
  it("returns a realism score with overall decision", async () => {
    const result = await evaluateMinimalQa({
      videoUrl: "https://cdn.example.com/video.mp4",
      specDescription: "Talking head confession ad",
      apiKey: "test-key",
    });
    expect(result.overallDecision).toBe("pass");
    expect(result.hardChecks).toBeDefined();
    expect(result.softScores).toBeDefined();
  });

  it("passes through artifact flags from Claude", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      decision: "fail",
      reasoning: "Face looks distorted",
      artifactFlags: ["face_drift", "hand_warp"],
    });

    const result = await evaluateMinimalQa({
      videoUrl: "https://cdn.example.com/video.mp4",
      specDescription: "Talking head ad",
      apiKey: "test-key",
    });
    expect(result.overallDecision).toBe("fail");
    expect(result.hardChecks.artifactFlags).toContain("face_drift");
  });
});
