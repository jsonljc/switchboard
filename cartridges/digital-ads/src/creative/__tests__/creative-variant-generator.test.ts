// ---------------------------------------------------------------------------
// Tests — CreativeVariantGenerator
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { CreativeVariantGenerator } from "../creative-variant-generator.js";

describe("CreativeVariantGenerator", () => {
  it("generates variants with default angles", () => {
    const generator = new CreativeVariantGenerator();
    const result = generator.generateVariants({
      productDescription: "Premium wireless headphones with noise cancellation",
      targetAudience: "remote workers and audiophiles",
    });

    // Default: 5 angles * 2 per angle = 10 variants
    expect(result.variants).toHaveLength(10);
    expect(result.angles).toEqual([
      "benefit-driven",
      "problem-solution",
      "social-proof",
      "urgency",
      "curiosity",
    ]);
    expect(result.totalGenerated).toBe(10);

    // Each variant should have required fields
    for (const variant of result.variants) {
      expect(typeof variant.headline).toBe("string");
      expect(variant.headline.length).toBeGreaterThan(0);
      expect(typeof variant.primaryText).toBe("string");
      expect(variant.primaryText.length).toBeGreaterThan(0);
      expect(typeof variant.description).toBe("string");
      expect(typeof variant.callToAction).toBe("string");
      expect(typeof variant.angle).toBe("string");
    }
  });

  it("generates variants with custom angles", () => {
    const generator = new CreativeVariantGenerator();
    const customAngles = ["benefit-driven", "urgency"];
    const result = generator.generateVariants({
      productDescription: "Organic coffee beans",
      targetAudience: "coffee lovers",
      angles: customAngles,
    });

    // 2 custom angles * 2 per angle = 4 variants
    expect(result.variants).toHaveLength(4);
    expect(result.angles).toEqual(customAngles);
    expect(result.totalGenerated).toBe(4);

    // Verify only requested angles are present
    const usedAngles = new Set(result.variants.map((v) => v.angle));
    expect(usedAngles.size).toBe(2);
    expect(usedAngles.has("benefit-driven")).toBe(true);
    expect(usedAngles.has("urgency")).toBe(true);
  });

  it("respects custom variantsPerAngle count", () => {
    const generator = new CreativeVariantGenerator();
    const result = generator.generateVariants({
      productDescription: "Fitness app",
      targetAudience: "gym enthusiasts",
      variantsPerAngle: 4,
    });

    // 5 default angles * 4 per angle = 20 variants
    expect(result.variants).toHaveLength(20);
    expect(result.totalGenerated).toBe(20);
  });

  it("generates valid output for all angle types", () => {
    const generator = new CreativeVariantGenerator();
    const allAngles = [
      "benefit-driven",
      "problem-solution",
      "social-proof",
      "urgency",
      "curiosity",
    ];

    const result = generator.generateVariants({
      productDescription: "SaaS project management tool",
      targetAudience: "startup founders",
      angles: allAngles,
      variantsPerAngle: 1,
    });

    expect(result.variants).toHaveLength(5);

    for (const variant of result.variants) {
      expect(variant.headline.length).toBeGreaterThan(0);
      expect(variant.primaryText.length).toBeGreaterThan(0);
      expect(variant.description.length).toBeGreaterThan(0);
      expect(variant.callToAction.length).toBeGreaterThan(0);
      expect(allAngles).toContain(variant.angle);
    }

    // Verify each angle produced a distinct headline
    const headlines = result.variants.map((v) => v.headline);
    const uniqueHeadlines = new Set(headlines);
    expect(uniqueHeadlines.size).toBe(5);
  });

  it("handles unknown angle type with fallback", () => {
    const generator = new CreativeVariantGenerator();
    const result = generator.generateVariants({
      productDescription: "Test product",
      targetAudience: "test audience",
      angles: ["unknown-angle"],
      variantsPerAngle: 1,
    });

    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]!.angle).toBe("unknown-angle");
    expect(result.variants[0]!.headline).toContain("Discover");
  });

  it("truncates long product descriptions in output", () => {
    const generator = new CreativeVariantGenerator();
    const longDescription = "A".repeat(200);
    const result = generator.generateVariants({
      productDescription: longDescription,
      targetAudience: "everyone",
      angles: ["benefit-driven"],
      variantsPerAngle: 1,
    });

    expect(result.variants).toHaveLength(1);
    // Product description gets sliced to 60 chars in the template
    expect(result.variants[0]!.primaryText.length).toBeLessThan(500);
  });
});
