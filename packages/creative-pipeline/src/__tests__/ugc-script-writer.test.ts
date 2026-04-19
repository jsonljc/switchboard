import { describe, it, expect, vi } from "vitest";
import { buildUgcScriptPrompt, runUgcScriptWriter } from "../ugc/ugc-script-writer.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    text: "Hey so I've been meaning to tell you about this thing...",
    language: "en",
  }),
}));

const baseBrief = {
  productDescription: "AI scheduling tool",
  targetAudience: "Small business owners",
  brandVoice: null as string | null,
};

const baseCreator = {
  name: "Sofia",
  personality: {
    energy: "conversational",
    deliveryStyle: "friendly",
    catchphrases: ["honestly though", "no cap"],
    forbiddenPhrases: ["limited time offer"],
  },
};

const baseStructure = {
  id: "confession",
  name: "Confession / Authentic Story",
  sections: [
    {
      name: "hook",
      purposeGuide: "Vulnerable admission",
      durationRange: [3, 5] as [number, number],
    },
    {
      name: "story",
      purposeGuide: "Personal narrative",
      durationRange: [8, 15] as [number, number],
    },
    {
      name: "reveal",
      purposeGuide: "Product as turning point",
      durationRange: [5, 10] as [number, number],
    },
    { name: "cta", purposeGuide: "Invitation to try", durationRange: [3, 5] as [number, number] },
  ],
};

describe("buildUgcScriptPrompt", () => {
  it("includes creator personality in prompt", () => {
    const { systemPrompt } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
    });
    expect(systemPrompt).toContain("Sofia");
    expect(systemPrompt).toContain("conversational");
    expect(systemPrompt).toContain("honestly though");
  });

  it("includes forbidden phrases", () => {
    const { systemPrompt } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
    });
    expect(systemPrompt).toContain("limited time offer");
  });

  it("includes script constraints from funnel frictions", () => {
    const { userMessage } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: ["set clear expectations early"],
      hookDirectives: ["increase hook novelty"],
    });
    expect(userMessage).toContain("set clear expectations early");
    expect(userMessage).toContain("increase hook novelty");
  });

  it("includes structure sections in prompt", () => {
    const { userMessage } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
    });
    expect(userMessage).toContain("hook");
    expect(userMessage).toContain("Vulnerable admission");
  });

  it("includes imperfection guidelines", () => {
    const { systemPrompt } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
    });
    expect(systemPrompt).toContain("filler");
    expect(systemPrompt).toContain("hesitation");
  });
});

describe("runUgcScriptWriter", () => {
  it("calls callClaude and returns script result", async () => {
    const result = await runUgcScriptWriter({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
      apiKey: "test-key",
    });
    expect(result).toBeDefined();
    expect(result.text).toBeTruthy();
  });
});
