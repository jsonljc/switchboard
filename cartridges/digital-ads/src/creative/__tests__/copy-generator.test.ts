import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdCopyGenerator } from "../copy-generator.js";
import type { BusinessContext, CampaignContext } from "../copy-generator.js";

function makeBusiness(overrides?: Partial<BusinessContext>): BusinessContext {
  return {
    businessName: "Bright Smile Dental",
    businessType: "dental clinic",
    services: [
      { name: "Teeth Whitening", typicalValue: 280 },
      { name: "General Dentistry", typicalValue: 150 },
    ],
    tone: "warm and professional",
    persona: "friendly dental office coordinator",
    bannedTopics: ["competitor names", "insurance complaints"],
    location: "San Francisco, CA",
    ...overrides,
  };
}

function makeCampaign(overrides?: Partial<CampaignContext>): CampaignContext {
  return {
    objective: "leads",
    targetAudience: "Adults 25-54 within 10 miles interested in cosmetic dentistry",
    servicePromoted: "Teeth Whitening",
    budget: 500,
    platform: "Meta",
    ...overrides,
  };
}

describe("AdCopyGenerator", () => {
  let generator: AdCopyGenerator;
  let mockGenerateFn: ReturnType<typeof vi.fn>;

  const validLLMResponse = JSON.stringify({
    headlines: [
      "Brighten Your Smile Today",
      "Professional Teeth Whitening",
      "Your Best Smile Awaits",
      "Whitening at Bright Smile",
      "Get a Radiant Smile",
    ],
    primaryTexts: [
      "Transform your smile with professional teeth whitening at Bright Smile Dental. Book your appointment today.",
      "Looking for teeth whitening in San Francisco? Our expert team delivers results you'll love.",
      "Discover the confidence of a brighter smile. Bright Smile Dental offers gentle, effective whitening.",
    ],
    cta: "Book Now",
    format: "single_image",
    formatReason: "Single image with clear CTA optimizes for lead generation.",
  });

  beforeEach(() => {
    mockGenerateFn = vi.fn().mockResolvedValue(validLLMResponse);
    generator = new AdCopyGenerator({ generateFn: mockGenerateFn });
  });

  describe("generate", () => {
    it("generates a complete ad copy package", async () => {
      const result = await generator.generate(makeBusiness(), makeCampaign());

      expect(result.id).toMatch(/^copy_/);
      expect(result.headlines).toHaveLength(5);
      expect(result.primaryTexts).toHaveLength(3);
      expect(result.ctaRecommendation).toBe("Book Now");
      expect(result.formatRecommendation).toBe("single_image");
      expect(result.formatReason).toBeTruthy();
    });

    it("calls LLM with business and campaign context", async () => {
      await generator.generate(makeBusiness(), makeCampaign());

      expect(mockGenerateFn).toHaveBeenCalledTimes(1);
      const prompt = mockGenerateFn.mock.calls[0]![0] as string;
      expect(prompt).toContain("Bright Smile Dental");
      expect(prompt).toContain("Teeth Whitening");
      expect(prompt).toContain("Adults 25-54");
      expect(prompt).toContain("warm and professional");
    });

    it("includes banned topics in prompt", async () => {
      await generator.generate(makeBusiness(), makeCampaign());

      const prompt = mockGenerateFn.mock.calls[0]![0] as string;
      expect(prompt).toContain("competitor names");
      expect(prompt).toContain("insurance complaints");
    });

    it("tracks character limit compliance for headlines", async () => {
      mockGenerateFn.mockResolvedValue(
        JSON.stringify({
          headlines: ["Short", "A".repeat(50)],
          primaryTexts: ["Body text"],
          cta: "Book Now",
          format: "single_image",
          formatReason: "test",
        }),
      );

      const result = await generator.generate(makeBusiness(), makeCampaign());

      expect(result.headlines[0]!.withinLimit).toBe(true);
      expect(result.headlines[1]!.withinLimit).toBe(false);
    });

    it("validates CTA against allowed list", async () => {
      mockGenerateFn.mockResolvedValue(
        JSON.stringify({
          headlines: ["Test"],
          primaryTexts: ["Body"],
          cta: "Invalid CTA",
          format: "single_image",
          formatReason: "test",
        }),
      );

      const result = await generator.generate(makeBusiness(), makeCampaign());
      expect(result.ctaRecommendation).toBe("Learn More"); // Falls back to default
    });

    it("validates format against allowed list", async () => {
      mockGenerateFn.mockResolvedValue(
        JSON.stringify({
          headlines: ["Test"],
          primaryTexts: ["Body"],
          cta: "Book Now",
          format: "invalid_format",
          formatReason: "test",
        }),
      );

      const result = await generator.generate(makeBusiness(), makeCampaign());
      expect(result.formatRecommendation).toBe("single_image"); // Falls back to default
    });

    it("detects compliance violations", async () => {
      mockGenerateFn.mockResolvedValue(
        JSON.stringify({
          headlines: ["We guarantee results!"],
          primaryTexts: ["100% safe treatment with no risk"],
          cta: "Book Now",
          format: "single_image",
          formatReason: "test",
        }),
      );

      const result = await generator.generate(makeBusiness(), makeCampaign());
      expect(result.complianceNotes.length).toBeGreaterThan(0);
      expect(result.complianceNotes.some((n) => n.includes("guarantee"))).toBe(true);
    });

    it("detects banned topics in generated copy", async () => {
      mockGenerateFn.mockResolvedValue(
        JSON.stringify({
          headlines: ["Better than competitor names!"],
          primaryTexts: ["Unlike insurance complaints, we're great"],
          cta: "Book Now",
          format: "single_image",
          formatReason: "test",
        }),
      );

      const result = await generator.generate(
        makeBusiness({ bannedTopics: ["competitor names"] }),
        makeCampaign(),
      );
      expect(result.complianceNotes.some((n) => n.includes("banned topic"))).toBe(true);
    });

    it("falls back to templates when LLM fails", async () => {
      mockGenerateFn.mockRejectedValue(new Error("LLM unavailable"));

      const result = await generator.generate(makeBusiness(), makeCampaign());

      expect(result.headlines.length).toBeGreaterThan(0);
      expect(result.primaryTexts.length).toBeGreaterThan(0);
      expect(result.ctaRecommendation).toBe("Book Now");
      expect(result.headlines[0]!.text).toContain("Teeth Whitening");
    });

    it("falls back to templates when LLM returns invalid JSON", async () => {
      mockGenerateFn.mockResolvedValue("This is not valid JSON at all");

      const result = await generator.generate(makeBusiness(), makeCampaign());

      expect(result.headlines.length).toBeGreaterThan(0);
      expect(result.primaryTexts.length).toBeGreaterThan(0);
    });

    it("handles missing optional business fields", async () => {
      const result = await generator.generate(
        { businessName: "My Shop", businessType: "retail" },
        makeCampaign(),
      );

      expect(result.headlines.length).toBeGreaterThan(0);
    });

    it("limits headlines to 5 and primary texts to 3", async () => {
      mockGenerateFn.mockResolvedValue(
        JSON.stringify({
          headlines: ["1", "2", "3", "4", "5", "6", "7"],
          primaryTexts: ["a", "b", "c", "d", "e"],
          cta: "Book Now",
          format: "single_image",
          formatReason: "test",
        }),
      );

      const result = await generator.generate(makeBusiness(), makeCampaign());
      expect(result.headlines.length).toBeLessThanOrEqual(5);
      expect(result.primaryTexts.length).toBeLessThanOrEqual(3);
    });
  });
});
