import { z } from "zod";

/**
 * Claim-type categories returned by the Layer 2 classifier (Haiku 4.5) for
 * each outbound sentence Alex generates.
 *
 * Note: `safety-claim` and `medical-advice` use kebab-case because these
 * values are LLM-facing — the classifier prompt (Task 10) instructs the
 * model to emit these exact strings, and changing them requires updating
 * both this enum and the prompt artifact's claim-type listing in lockstep.
 */
export const ClaimTypeSchema = z.enum([
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
  "testimonial",
  "medical-advice",
  "diagnosis",
  "credentials",
  "none",
]);

export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const ClassifierSentenceResultSchema = z.object({
  sentence: z.string().min(1),
  claimType: ClaimTypeSchema,
  confidence: z.number().min(0).max(1),
});

export type ClassifierSentenceResult = z.infer<typeof ClassifierSentenceResultSchema>;

/**
 * Versions the shape of `ClassifierSentenceResultSchema`. Stamped into every
 * `GovernanceVerdict.details.schemaVersion` by `ClaimClassifierHook` so a
 * future shape change (e.g., adding fields or splitting `claimType`) is
 * traceable in the audit log without losing the historical interpretation
 * of older verdict rows. Bump on any wire-format change to the result shape.
 */
export const CLASSIFIER_SCHEMA_VERSION = "1.0.0" as const;
