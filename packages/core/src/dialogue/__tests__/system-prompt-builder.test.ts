import { describe, it, expect } from "vitest";
import { buildLocalisedSystemPrompt } from "../system-prompt-builder.js";
import type { NaturalnessPacket } from "../types.js";

function makePacket(overrides?: Partial<NaturalnessPacket>): NaturalnessPacket {
  return {
    primaryMove: "greet",
    approvedContent: "Welcome to our clinic!",
    voice: {
      naturalness: "semi_formal",
      market: "SG",
      emojiPolicy: { allowed: false, maxPerMessage: 0, preferredSet: [] },
    },
    constraints: {
      maxSentences: 3,
      maxWords: 60,
      forbiddenPhrases: ["As an AI"],
      bannedTopics: ["competitor pricing"],
      singleQuestionOnly: true,
      noEmDashes: true,
    },
    leadContext: {
      name: "Sarah",
      serviceInterest: "whitening",
      previousTurnCount: 0,
    },
    variation: {
      openingStyle: "direct",
      recentlyUsedPhrases: [],
      avoidPatterns: [],
    },
    ...overrides,
  };
}

describe("buildLocalisedSystemPrompt", () => {
  it("should include persona block", () => {
    const prompt = buildLocalisedSystemPrompt(makePacket());
    expect(prompt).toContain("lead-engagement assistant");
  });

  it("should include SG voice instructions", () => {
    const prompt = buildLocalisedSystemPrompt(makePacket());
    expect(prompt).toContain("Singaporean English");
  });

  it("should include emoji policy", () => {
    const prompt = buildLocalisedSystemPrompt(makePacket());
    expect(prompt).toContain("Do NOT use emoji");
  });

  it("should include constraints", () => {
    const prompt = buildLocalisedSystemPrompt(makePacket());
    expect(prompt).toContain("Maximum 3 sentences");
    expect(prompt).toContain("NEVER use these phrases");
    expect(prompt).toContain("As an AI");
  });

  it("should include approved content", () => {
    const prompt = buildLocalisedSystemPrompt(makePacket());
    expect(prompt).toContain("Welcome to our clinic!");
  });

  it("should include lead context", () => {
    const prompt = buildLocalisedSystemPrompt(makePacket());
    expect(prompt).toContain("Sarah");
    expect(prompt).toContain("whitening");
  });

  it("should include move instructions", () => {
    const prompt = buildLocalisedSystemPrompt(makePacket());
    expect(prompt).toContain("YOUR MOVE: greet");
    expect(prompt).toContain("Welcome the lead warmly");
  });

  it("should include business context when provided", () => {
    const prompt = buildLocalisedSystemPrompt(makePacket(), "Business: Bright Smile Dental");
    expect(prompt).toContain("Bright Smile Dental");
  });

  it("should handle different moves", () => {
    const prompt = buildLocalisedSystemPrompt(makePacket({ primaryMove: "handle_objection" }));
    expect(prompt).toContain("Address their concern directly");
  });
});
