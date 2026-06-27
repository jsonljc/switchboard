import { z } from "zod";

/**
 * Seam 1 (Alex -> Mira) handoff payload: the creative concept brief Alex hands
 * Mira as a DRAFT for a qualified, interested lead. The single home for this
 * shape (Governed Handoff Contract Freeze, schema-anchor rule). The
 * DelegationTarget.mapInput in apps/api wraps this as { brief: { ... } } with the
 * pipeline defaults (platforms, productImages, references).
 *
 * `valueContext` is additive and optional (a Safe evolution): the lead's interest
 * signal / estimated value so Mira can prioritize. `estimatedValue` is in MINOR
 * currency units (cents), consistent with ConversionEvent.value (Seam 4 §4.4).
 */
export const CreativeConceptDraftValueContext = z.object({
  estimatedValue: z.number().optional(),
  interestSignal: z.string().optional(),
});
export type CreativeConceptDraftValueContext = z.infer<typeof CreativeConceptDraftValueContext>;

/**
 * D6-3: Riley's structured diagnosis, carried into the Mira brief AS DATA (not only as the brief's
 * free text) so the creative pipeline can route on it. campaignId + actionType are the routable
 * core; diagnosis (a label) and evidence are optional context.
 */
export const RileyDiagnosisContext = z.object({
  campaignId: z.string().min(1),
  actionType: z.string().min(1),
  diagnosis: z.string().optional(),
  evidence: z.object({ clicks: z.number(), conversions: z.number(), days: z.number() }).optional(),
});
export type RileyDiagnosisContext = z.infer<typeof RileyDiagnosisContext>;

export const CreativeConceptDraftInput = z.object({
  productDescription: z.string().min(1),
  targetAudience: z.string().min(1),
  valueContext: CreativeConceptDraftValueContext.optional(),
  // D6-3: additive + optional (Safe evolution, matches the valueContext precedent) so every
  // existing producer that omits it still parses; the Riley->Mira handoff threads it through.
  rileyDiagnosis: RileyDiagnosisContext.optional(),
});
export type CreativeConceptDraftInput = z.infer<typeof CreativeConceptDraftInput>;

/**
 * The strict tool `inputSchema` projection of {@link CreativeConceptDraftInput}
 * for the Alex -> Mira `delegate.creative_concept` operation. The single source
 * of truth so the live delegate target (apps/api delegation-targets.ts) and the
 * alex-conversation eval mock present the EXACT same contract (EV-5/AGENT-5
 * mock-tool-blind parity). Strict tools 400 on min/max, so the Zod parse in
 * `mapInput` carries the min(1) + optional-field validation this schema cannot.
 */
export const CREATIVE_CONCEPT_TOOL_INPUT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: "object",
  properties: {
    productDescription: {
      type: "string",
      description: "Treatment/offer the lead is interested in, e.g. 'Botox for first-time clients'",
    },
    targetAudience: {
      type: "string",
      description: "Who the concept targets, e.g. 'women 30-45, anti-aging curious'",
    },
  },
  required: ["productDescription", "targetAudience"],
});
