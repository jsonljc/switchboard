import type { DelegationTarget } from "@switchboard/core/skill-runtime";
import { CreativeConceptDraftInput } from "@switchboard/schemas";

/**
 * Alex -> Mira: draft a creative concept for an interested, qualified lead.
 * Draft-only (no spend); parks nothing - it just records a concept for the team.
 *
 * The input shape is the centralized Seam-1 type (CreativeConceptDraftInput,
 * Governed Handoff Contract Freeze). The strict tool `inputSchema` below carries
 * no min/max (Anthropic strict tools 400 on them); the Zod parse in mapInput adds
 * the min(1) + optional valueContext validation the tool schema cannot express,
 * and fails closed on a malformed brief (the delegate tool then reports a failure,
 * never a phantom draft).
 */
export const CREATIVE_CONCEPT_TARGET: DelegationTarget = {
  operation: "creative_concept",
  intent: "creative.concept.draft",
  description:
    "Hand a creative concept to Mira (the creative agent) as a DRAFT for the team to review. " +
    "Use ONLY for a clearly interested, qualified lead who would benefit from a tailored offer/creative. " +
    "This creates an internal draft on the team's board - it does NOT send anything to the customer and " +
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
    const i = CreativeConceptDraftInput.parse(input);
    return {
      brief: {
        productDescription: i.productDescription,
        targetAudience: i.targetAudience,
        platforms: ["instagram"],
        productImages: [],
        references: [],
        generateReferenceImages: false,
        ...(i.valueContext ? { valueContext: i.valueContext } : {}),
      },
    };
  },
};

export const DELEGATION_TARGETS: DelegationTarget[] = [CREATIVE_CONCEPT_TARGET];
