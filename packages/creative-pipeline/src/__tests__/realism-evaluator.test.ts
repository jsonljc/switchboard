// Real frame-QA evaluator (slice-3 spec 3.1): with deps present and the chain
// succeeding, evaluateRealism returns qaStatus "evaluated" + a computeDecision
// verdict; on ANY infrastructure shortfall (deps absent, extractor failure,
// vision failure, schema-invalid reply) it returns the honest-stub result so
// the pipeline routes to a human and never blocks on QA infrastructure.
import { describe, it, expect, vi } from "vitest";
import { evaluateRealism, buildQaPrompt, type RealismScorerDeps } from "../ugc/realism-scorer.js";
import type { ExtractedFrames } from "../ugc/frame-extractor.js";

const frames: ExtractedFrames = {
  frames: ["QUJD", "REVG"],
  localVideoPath: "/tmp/source.mp4",
  workDir: "/tmp/work",
};

function makeDeps(overrides: Partial<RealismScorerDeps> = {}): RealismScorerDeps {
  return {
    frameExtractor: { extract: vi.fn().mockResolvedValue(frames) },
    vision: vi.fn().mockResolvedValue({
      artifactFlags: [],
      humanPresent: true,
      softScores: { visualRealism: 0.8, behavioralRealism: 0.8, ugcAuthenticity: 0.8 },
    }),
    ...overrides,
  };
}

const input = {
  videoUrl: "https://cdn.example.com/clip.mp4",
  specDescription: "talking_head confession ad",
  apiKey: "k",
  format: "talking_head",
  durationSec: 10,
};

describe("evaluateRealism (real path)", () => {
  it("without deps stays the honest stub", async () => {
    const score = await evaluateRealism(input);
    expect(score.qaStatus).toBe("requires_human_review");
    expect(score.overallDecision).toBe("review");
  });

  it("evaluates with frames: qaStatus evaluated, decision from computeDecision, no audio score", async () => {
    const deps = makeDeps();
    const score = await evaluateRealism(input, deps);
    expect(score.qaStatus).toBe("evaluated");
    expect(score.overallDecision).toBe("pass");
    expect(score.softScores.audioNaturalness).toBeUndefined();
    expect(deps.frameExtractor.extract).toHaveBeenCalledWith(input.videoUrl, 10);
    const visionCall = (deps.vision as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(visionCall.images).toEqual(frames.frames);
  });

  it("appends missing_subject for a talking_head clip with no human, failing the gate", async () => {
    const deps = makeDeps({
      vision: vi.fn().mockResolvedValue({
        artifactFlags: [],
        humanPresent: false,
        softScores: { visualRealism: 0.9, behavioralRealism: 0.9, ugcAuthenticity: 0.9 },
      }),
    });
    const score = await evaluateRealism(input, deps);
    expect(score.qaStatus).toBe("evaluated");
    expect(score.hardChecks.artifactFlags).toContain("missing_subject");
    expect(score.overallDecision).toBe("fail");
  });

  it("does not append missing_subject for non-talking_head formats", async () => {
    const deps = makeDeps({
      vision: vi.fn().mockResolvedValue({
        artifactFlags: [],
        humanPresent: false,
        softScores: { visualRealism: 0.9, behavioralRealism: 0.9, ugcAuthenticity: 0.9 },
      }),
    });
    const score = await evaluateRealism({ ...input, format: "product_in_hand" }, deps);
    expect(score.hardChecks.artifactFlags).not.toContain("missing_subject");
    expect(score.overallDecision).toBe("pass");
  });

  it("degrades to the honest stub when the extractor throws", async () => {
    const deps = makeDeps({
      frameExtractor: { extract: vi.fn().mockRejectedValue(new Error("ssrf rejected")) },
    });
    const score = await evaluateRealism(input, deps);
    expect(score.qaStatus).toBe("requires_human_review");
    expect(score.overallDecision).toBe("review");
  });

  it("degrades to the honest stub when the vision call throws", async () => {
    const deps = makeDeps({
      vision: vi.fn().mockRejectedValue(new Error("schema validation failed")),
    });
    const score = await evaluateRealism(input, deps);
    expect(score.qaStatus).toBe("requires_human_review");
  });
});

describe("buildQaPrompt", () => {
  it("pins objective integrity and forbids aesthetic judgment", () => {
    const prompt = buildQaPrompt(input);
    expect(prompt).toContain("Do not judge aesthetic");
    expect(prompt).toContain("garbled_text");
    expect(prompt).toContain(input.specDescription);
  });
});
