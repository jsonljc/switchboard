import { describe, it, expect } from "vitest";
import {
  ClaimTypeSchema,
  ClassifierSentenceResultSchema,
  CLASSIFIER_SCHEMA_VERSION,
} from "../claim-classifier.js";

describe("ClaimTypeSchema", () => {
  it.each([
    "efficacy",
    "safety-claim",
    "superiority",
    "urgency",
    "testimonial",
    "medical-advice",
    "diagnosis",
    "credentials",
    "none",
  ])("accepts %s", (value) => {
    expect(ClaimTypeSchema.safeParse(value).success).toBe(true);
  });

  it("rejects unknown claim types", () => {
    expect(ClaimTypeSchema.safeParse("comparative").success).toBe(false);
  });
});

describe("ClassifierSentenceResultSchema", () => {
  it("round-trips a valid result", () => {
    const input = {
      sentence: "Most clients see visible slimming after one session.",
      claimType: "efficacy" as const,
      confidence: 0.92,
    };
    const result = ClassifierSentenceResultSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(
      ClassifierSentenceResultSchema.safeParse({
        sentence: "x",
        claimType: "none",
        confidence: 1.5,
      }).success,
    ).toBe(false);
    expect(
      ClassifierSentenceResultSchema.safeParse({
        sentence: "x",
        claimType: "none",
        confidence: -0.1,
      }).success,
    ).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(
      ClassifierSentenceResultSchema.safeParse({
        sentence: "x",
        claimType: "none",
      }).success,
    ).toBe(false);
  });

  it("rejects an empty sentence", () => {
    expect(
      ClassifierSentenceResultSchema.safeParse({
        sentence: "",
        claimType: "none",
        confidence: 0.5,
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown claimType inside the composed object", () => {
    expect(
      ClassifierSentenceResultSchema.safeParse({
        sentence: "x",
        claimType: "bogus",
        confidence: 0.5,
      }).success,
    ).toBe(false);
  });
});

describe("CLASSIFIER_SCHEMA_VERSION", () => {
  it("exports the v1.0.0 constant", () => {
    expect(CLASSIFIER_SCHEMA_VERSION).toBe("1.0.0");
  });
});
