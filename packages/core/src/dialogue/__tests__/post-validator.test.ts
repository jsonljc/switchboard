import { describe, it, expect } from "vitest";
import { PostGenerationValidator } from "../post-validator.js";

describe("PostGenerationValidator", () => {
  const validator = new PostGenerationValidator();

  it("should pass clean text", () => {
    const result = validator.validate("Welcome! How can I help you today?", "greet");
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("should block medical guarantee claims", () => {
    const result = validator.validate("We guarantee results for all patients", "answer_question");
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "medical_guarantee_claim")).toBe(true);
  });

  it("should block dosage mentions", () => {
    const result = validator.validate("Take 500mg twice daily", "answer_question");
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "dosage_mention")).toBe(true);
  });

  it("should escalate diagnosis claims", () => {
    const result = validator.validate("You have a cavity that needs filling", "answer_question");
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "diagnosis_claim")).toBe(true);
    expect(result.violations.find((v) => v.rule === "diagnosis_claim")?.severity).toBe("escalate");
  });

  it("should block permanence claims", () => {
    const result = validator.validate(
      "Results are permanent and will never come back",
      "answer_question",
    );
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "permanence_claim")).toBe(true);
  });

  it("should warn on em dashes", () => {
    const result = validator.validate(
      "This treatment — which is very popular — is great",
      "answer_question",
    );
    expect(result.valid).toBe(true); // warn doesn't block
    expect(result.violations.some((v) => v.rule === "em_dash_usage")).toBe(true);
  });

  it("should warn on multiple questions", () => {
    const result = validator.validate(
      "What service? And when would you like?",
      "ask_qualification_question",
    );
    expect(result.violations.some((v) => v.rule === "multiple_questions")).toBe(true);
  });

  it("should provide fallback message when blocked", () => {
    const result = validator.validate("Guaranteed cure for all issues", "greet");
    expect(result.valid).toBe(false);
    expect(result.fallbackMessage).toBeDefined();
    expect(result.fallbackMessage).toContain("Hi");
  });

  it("should check configurable forbidden phrases", () => {
    const custom = new PostGenerationValidator({
      forbiddenPhrases: ["custom banned phrase"],
    });
    const result = custom.validate("This is a custom banned phrase in response", "greet");
    expect(result.violations.some((v) => v.rule === "forbidden_phrase")).toBe(true);
  });

  it("should block configurable banned topics", () => {
    const custom = new PostGenerationValidator({
      bannedTopics: ["competitor pricing"],
    });
    const result = custom.validate("Our competitor pricing is much higher", "answer_question");
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "banned_topic")).toBe(true);
  });
});
