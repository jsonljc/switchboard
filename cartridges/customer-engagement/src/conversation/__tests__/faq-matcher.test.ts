import { describe, it, expect } from "vitest";
import { matchFAQ, formatFAQResponse } from "../faq-matcher.js";
import type { FAQRecord } from "@switchboard/schemas";

const testFAQs: FAQRecord[] = [
  {
    question: "Does Botox hurt?",
    variants: ["Is Botox painful?", "Will Botox injections hurt?"],
    answer:
      "Most patients describe Botox as a mild pinch. We use topical numbing cream to minimize any discomfort.",
    topic: "procedure",
    sensitive: false,
  },
  {
    question: "How much does teeth whitening cost?",
    variants: ["What is the price for teeth whitening?", "Whitening pricing"],
    answer:
      "Our professional teeth whitening starts at $299 for in-office treatment. Take-home kits are available from $149.",
    topic: "pricing",
    sensitive: false,
  },
  {
    question: "What are the side effects of dermal fillers?",
    variants: ["Are there risks with fillers?", "Filler side effects"],
    answer:
      "Common side effects include temporary redness, swelling, and bruising at the injection site, typically resolving within 24-48 hours.",
    topic: "procedure",
    sensitive: true,
  },
  {
    question: "Do you accept insurance?",
    variants: ["Is insurance accepted?", "Can I use my insurance?"],
    answer:
      "We accept most major dental insurance plans. Please contact us with your insurance details for verification.",
    topic: "billing",
    sensitive: false,
  },
];

describe("FAQ Matcher", () => {
  describe("matchFAQ", () => {
    it("returns exact match with confidence 1.0 and direct tier", () => {
      const result = matchFAQ("Does Botox hurt?", testFAQs);
      expect(result.confidence).toBe(1.0);
      expect(result.tier).toBe("direct");
      expect(result.match?.question).toBe("Does Botox hurt?");
    });

    it("matches against variants (case-insensitive)", () => {
      const result = matchFAQ("is botox painful?", testFAQs);
      expect(result.confidence).toBe(1.0);
      expect(result.tier).toBe("direct");
      expect(result.match?.question).toBe("Does Botox hurt?");
    });

    it("matches substring with high confidence", () => {
      const result = matchFAQ("teeth whitening cost", testFAQs);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.match?.topic).toBe("pricing");
    });

    it("returns escalate tier for unrelated questions", () => {
      const result = matchFAQ("What is the meaning of life?", testFAQs);
      expect(result.tier).toBe("escalate");
      expect(result.match).toBeNull();
    });

    it("handles empty FAQ list", () => {
      const result = matchFAQ("Does Botox hurt?", []);
      expect(result.tier).toBe("escalate");
      expect(result.confidence).toBe(0);
    });

    it("handles empty message", () => {
      const result = matchFAQ("", testFAQs);
      expect(result.tier).toBe("escalate");
      expect(result.confidence).toBe(0);
    });

    it("matches partial keyword overlap with moderate confidence", () => {
      const result = matchFAQ("I want to know about filler risks", testFAQs);
      expect(result.confidence).toBeGreaterThan(0);
      // Should match the filler FAQ due to keyword overlap
      if (result.match) {
        expect(result.match.topic).toBe("procedure");
      }
    });

    it("handles punctuation in input gracefully", () => {
      const result = matchFAQ("Does Botox hurt??!", testFAQs);
      expect(result.confidence).toBe(1.0);
      expect(result.tier).toBe("direct");
    });

    it("is case-insensitive", () => {
      const result = matchFAQ("DOES BOTOX HURT", testFAQs);
      expect(result.confidence).toBe(1.0);
      expect(result.tier).toBe("direct");
    });
  });

  describe("formatFAQResponse", () => {
    it("returns answer directly for direct tier", () => {
      const result = matchFAQ("Does Botox hurt?", testFAQs);
      const response = formatFAQResponse(result);
      expect(response).toBe(
        "Most patients describe Botox as a mild pinch. We use topical numbing cream to minimize any discomfort.",
      );
    });

    it("adds caveat framing for caveat tier", () => {
      // Force a caveat result
      const caveatResult = {
        match: testFAQs[0]!,
        confidence: 0.75,
        tier: "caveat" as const,
      };
      const response = formatFAQResponse(caveatResult);
      expect(response).toContain("general information");
      expect(response).toContain("Most patients describe Botox");
    });

    it("adds sensitive prefix for sensitive FAQs in caveat tier", () => {
      const caveatResult = {
        match: testFAQs[2]!, // sensitive FAQ
        confidence: 0.7,
        tier: "caveat" as const,
      };
      const response = formatFAQResponse(caveatResult, "Bright Smiles Clinic");
      expect(response).toContain("Based on our general information at Bright Smiles Clinic");
    });

    it("returns null for escalate tier", () => {
      const escalateResult = {
        match: null,
        confidence: 0.3,
        tier: "escalate" as const,
      };
      const response = formatFAQResponse(escalateResult);
      expect(response).toBeNull();
    });
  });
});
