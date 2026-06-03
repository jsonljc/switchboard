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

export const CreativeConceptDraftInput = z.object({
  productDescription: z.string().min(1),
  targetAudience: z.string().min(1),
  valueContext: CreativeConceptDraftValueContext.optional(),
});
export type CreativeConceptDraftInput = z.infer<typeof CreativeConceptDraftInput>;
