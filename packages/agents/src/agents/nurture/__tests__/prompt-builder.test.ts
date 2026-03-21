import { describe, it, expect } from "vitest";
import { buildNurturePrompt } from "../prompt-builder.js";

describe("buildNurturePrompt", () => {
  it("includes cadence type and template key in instructions", () => {
    const prompt = buildNurturePrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      cadenceType: "post-treatment-review",
      templateKey: "review-request",
      reviewPlatformLink: "https://g.page/clinic/review",
    });
    expect(prompt.agentInstructions).toContain("post-treatment-review");
    expect(prompt.agentInstructions).toContain("review-request");
  });

  it("includes review platform link when provided", () => {
    const prompt = buildNurturePrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      cadenceType: "post-treatment-review",
      templateKey: "review-request",
      reviewPlatformLink: "https://g.page/clinic/review",
    });
    expect(prompt.agentInstructions).toContain("https://g.page/clinic/review");
  });

  it("works without review platform link", () => {
    const prompt = buildNurturePrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      cadenceType: "consultation-reminder",
      templateKey: "reminder-24h",
    });
    expect(prompt.agentInstructions).toContain("consultation-reminder");
  });
});
