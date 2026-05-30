import type { DelegationTarget } from "@switchboard/core/skill-runtime";

/**
 * Alex→Mira: draft a creative concept for an interested, qualified lead.
 * Draft-only (no spend); parks nothing — it just records a concept for the team.
 */
export const CREATIVE_CONCEPT_TARGET: DelegationTarget = {
  operation: "creative_concept",
  intent: "creative.concept.draft",
  description:
    "Hand a creative concept to Mira (the creative agent) as a DRAFT for the team to review. " +
    "Use ONLY for a clearly interested, qualified lead who would benefit from a tailored offer/creative. " +
    "This creates an internal draft on the team's board — it does NOT send anything to the customer and " +
    "does NOT replace escalate. Provide the treatment/offer the lead wants and who it targets.",
  inputSchema: {
    type: "object",
    properties: {
      productDescription: {
        type: "string",
        description:
          "Treatment/offer the lead is interested in, e.g. 'Botox for first-time clients'",
      },
      targetAudience: {
        type: "string",
        description: "Who the concept targets, e.g. 'women 30-45, anti-aging curious'",
      },
    },
    required: ["productDescription", "targetAudience"],
  },
  mapInput: (input: unknown) => {
    const i = input as { productDescription: string; targetAudience: string };
    return {
      brief: {
        productDescription: i.productDescription,
        targetAudience: i.targetAudience,
        platforms: ["instagram"],
        productImages: [],
        references: [],
        generateReferenceImages: false,
      },
    };
  },
};

export const DELEGATION_TARGETS: DelegationTarget[] = [CREATIVE_CONCEPT_TARGET];
