import { describe, it, expect } from "vitest";
import { FixtureRowSchema, BaselineSchema } from "../schema.js";

describe("FixtureRowSchema", () => {
  it("accepts a minimal valid fixture row", () => {
    const row = {
      id: "sg-efficacy-001",
      text: "Guaranteed to remove all tattoo ink in one session.",
      language: "en",
      jurisdiction: "SG",
      expectedClaimType: "efficacy",
    };
    expect(FixtureRowSchema.parse(row)).toEqual(row);
  });

  it("rejects an unknown claim type", () => {
    const row = {
      id: "x",
      text: "y",
      language: "en",
      jurisdiction: "SG",
      expectedClaimType: "marketing-fluff",
    };
    expect(() => FixtureRowSchema.parse(row)).toThrow();
  });

  it("rejects an unknown jurisdiction", () => {
    const row = {
      id: "x",
      text: "y",
      language: "en",
      jurisdiction: "US",
      expectedClaimType: "none",
    };
    expect(() => FixtureRowSchema.parse(row)).toThrow();
  });

  it("accepts optional acceptableClaimTypes", () => {
    const row = {
      id: "x",
      text: "y",
      language: "en",
      jurisdiction: "SG",
      expectedClaimType: "efficacy",
      acceptableClaimTypes: ["safety-claim"],
    };
    expect(FixtureRowSchema.parse(row).acceptableClaimTypes).toEqual(["safety-claim"]);
  });
});

describe("BaselineSchema", () => {
  it("parses a minimal baseline", () => {
    const baseline = {
      version: 1,
      generatedAt: "2026-05-16T00:00:00.000Z",
      classifierPromptHash: "abc123",
      classifierPromptVersion: "claim-classifier@1.0.0",
      totalFixtures: 10,
      overallAccuracy: 0.9,
      perClaimTypeAccuracy: {
        efficacy: { correct: 3, total: 3, accuracy: 1 },
      },
      toleranceBps: 200,
    };
    expect(BaselineSchema.parse(baseline).version).toBe(1);
  });
});
