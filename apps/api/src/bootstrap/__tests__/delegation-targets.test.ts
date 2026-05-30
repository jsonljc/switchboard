import { describe, it, expect } from "vitest";
import { CREATIVE_CONCEPT_TARGET } from "../delegation-targets.js";

describe("CREATIVE_CONCEPT_TARGET", () => {
  it("maps a brief into child params under `brief` with safe defaults", () => {
    const mapped = CREATIVE_CONCEPT_TARGET.mapInput({
      productDescription: "Botox",
      targetAudience: "women 30-45",
    });
    expect(mapped).toEqual({
      brief: {
        productDescription: "Botox",
        targetAudience: "women 30-45",
        platforms: ["instagram"],
        productImages: [],
        references: [],
        generateReferenceImages: false,
      },
    });
  });

  it("targets the creative.concept.draft intent and uses no min/max in its schema", () => {
    expect(CREATIVE_CONCEPT_TARGET.intent).toBe("creative.concept.draft");
    const json = JSON.stringify(CREATIVE_CONCEPT_TARGET.inputSchema);
    expect(json).not.toMatch(/min|max/i);
  });
});
