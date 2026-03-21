import { describe, it, expect } from "vitest";
import { buildSalesCloserPrompt } from "../prompt-builder.js";

describe("buildSalesCloserPrompt", () => {
  it("includes booking URL in agent instructions", () => {
    const prompt = buildSalesCloserPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      bookingUrl: "https://cal.com/clinic",
      urgencyEnabled: true,
    });
    expect(prompt.agentInstructions).toContain("https://cal.com/clinic");
  });

  it("includes urgency instructions when enabled", () => {
    const prompt = buildSalesCloserPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      bookingUrl: "https://cal.com/clinic",
      urgencyEnabled: true,
    });
    expect(prompt.agentInstructions).toContain("urgency");
  });

  it("omits urgency instructions when disabled", () => {
    const prompt = buildSalesCloserPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      bookingUrl: "https://cal.com/clinic",
      urgencyEnabled: false,
    });
    expect(prompt.agentInstructions).not.toContain("limited slots");
  });

  it("includes social proof instruction", () => {
    const prompt = buildSalesCloserPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      bookingUrl: "https://cal.com/clinic",
      urgencyEnabled: true,
    });
    expect(prompt.agentInstructions).toContain("testimonial");
  });

  it("uses tone preset and language directive in system prompt", () => {
    const prompt = buildSalesCloserPrompt({
      history: [],
      chunks: [],
      tonePreset: "direct-efficient",
      language: "ms",
      bookingUrl: "https://cal.com/clinic",
      urgencyEnabled: false,
    });
    expect(prompt.systemPrompt).toContain("concise");
    expect(prompt.systemPrompt).toContain("Malay");
  });
});
