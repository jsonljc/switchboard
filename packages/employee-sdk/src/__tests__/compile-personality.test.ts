import { describe, it, expect } from "vitest";
import { compilePersonality } from "../compile-personality.js";

describe("compilePersonality", () => {
  it("builds a prompt with role, tone, and traits", () => {
    const prompt = compilePersonality({
      role: "You are a creative strategist.",
      tone: "professional yet approachable",
      traits: ["data-driven", "brand-aware", "concise"],
    });

    const text = prompt.toPrompt();
    expect(text).toContain("You are a creative strategist.");
    expect(text).toContain("Tone: professional yet approachable.");
    expect(text).toContain("Key traits: data-driven, brand-aware, concise.");
  });

  it("omits traits line when empty", () => {
    const prompt = compilePersonality({
      role: "You are a test.",
      tone: "neutral",
      traits: [],
    });

    const text = prompt.toPrompt();
    expect(text).not.toContain("Key traits");
  });
});
