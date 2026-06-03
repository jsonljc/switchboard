import { describe, it, expect } from "vitest";
import { CreativeConceptDraftInput } from "@switchboard/schemas";
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

  it("threads an optional valueContext through to the brief (schema-anchored)", () => {
    const mapped = CREATIVE_CONCEPT_TARGET.mapInput({
      productDescription: "Botox",
      targetAudience: "women 30-45",
      valueContext: { estimatedValue: 45000, interestSignal: "asked about pricing twice" },
    }) as { brief: { valueContext?: { estimatedValue?: number } } };
    expect(mapped.brief.valueContext?.estimatedValue).toBe(45000);
  });

  it("fails closed (throws) on a malformed brief - the centralized schema is the source of truth", () => {
    expect(() =>
      CREATIVE_CONCEPT_TARGET.mapInput({ productDescription: "", targetAudience: "x" }),
    ).toThrow();
    // The schema this target validates against is the canonical Seam-1 type.
    expect(() =>
      CreativeConceptDraftInput.parse({ productDescription: "Botox", targetAudience: "women" }),
    ).not.toThrow();
  });
});
