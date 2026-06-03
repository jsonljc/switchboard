import type { BusinessFacts } from "@switchboard/schemas";

/**
 * Synthesize a creative.concept.draft brief for Riley's cron handoff from the org's
 * BusinessFacts.
 *
 * Riley's weekly cron has NO conversational brief source (unlike Alex's delegate
 * tool), and no field stores a product/audience pair for the ad-optimizer
 * org/deployment (verified 2026-06-03 agent-synergy audit). So we derive an HONEST
 * brief from the operator-authored BusinessFacts (services + idealFor) with a locked
 * medspa-vertical fallback. Both fields are GUARANTEED non-empty: CreativeConceptDraftInput
 * requires `.min(1)` on each, and the downstream creative.concept.draft workflow
 * re-validates, so an empty brief would fail the handoff INVALID_HANDOFF post-approval.
 */
export interface SynthesizedCreativeBrief {
  productDescription: string;
  targetAudience: string;
}

// Locked vertical (medspa / aesthetic clinics). Used as the honest fallback when
// BusinessFacts is absent or carries no audience signal — never an empty string.
const FALLBACK_PRODUCT = "Aesthetic clinic treatments and services";
const FALLBACK_AUDIENCE = "Aesthetic-clinic prospects considering treatments";

export function synthesizeCreativeBrief(facts: BusinessFacts | null): SynthesizedCreativeBrief {
  if (!facts) {
    return { productDescription: FALLBACK_PRODUCT, targetAudience: FALLBACK_AUDIENCE };
  }

  const serviceNames = facts.services.map((s) => s.name.trim()).filter((n) => n.length > 0);
  const businessName = facts.businessName.trim();
  const productDescription =
    serviceNames.length > 0
      ? `${businessName || "Aesthetic clinic"}: ${serviceNames.join(", ")}`
      : businessName
        ? `${businessName} aesthetic clinic treatments`
        : FALLBACK_PRODUCT;

  const idealFor = facts.services
    .map((s) => s.idealFor?.trim())
    .find((v): v is string => !!v && v.length > 0);
  const targetAudience = idealFor ?? FALLBACK_AUDIENCE;

  return { productDescription, targetAudience };
}
