import { z } from "zod";

/**
 * Substantiation tier types. Layer 3 of the 1b-2 classifier pipeline
 * dispatches a flagged claim sentence against these tiers in priority
 * order per claim type (see SOURCE_TIERS_BY_CLAIM_TYPE in the
 * substantiation resolver — Task 14).
 *
 * - operator_business_fact: structured Service fields (price, hours, etc.)
 *   shipped by 1a. Reserved in 1b-2; not consumed by the resolver.
 * - approved_compliance_claim: operator-authored efficacy / safety /
 *   superiority / urgency claim with named reviewer + reviewedAt + 180d
 *   freshness window. Persisted in the Prisma table added by Task 5.
 * - regulatory_public_source: curated TS reference data for HSA / MDA
 *   approved devices, SMC / MMC credential paths, MOH / KKM clinic
 *   licence language. Shipped by Task 8.
 */
export const SubstantiationSourceTypeSchema = z.enum([
  "operator_business_fact",
  "approved_compliance_claim",
  "regulatory_public_source",
]);

export type SubstantiationSourceType = z.infer<typeof SubstantiationSourceTypeSchema>;

/**
 * Outcome of a Layer 3 substantiation lookup.
 *
 * - matched: a non-stale source exists and was substring-matched.
 * - stale: a source exists but reviewedAt > 180 days OR validUntil < now.
 *   Treated as missing for action selection but emits the distinct
 *   GovernanceVerdict.reasonCode "claim_substantiation_stale" so operators
 *   can triage re-review vs new authoring.
 * - missing: no source matches.
 */
export const SubstantiationResolutionSchema = z.object({
  status: z.enum(["matched", "stale", "missing"]),
  sourceType: SubstantiationSourceTypeSchema.optional(),
  sourceId: z.string().min(1).optional(),
  matchedText: z.string().min(1).optional(),
});

export type SubstantiationResolution = z.infer<typeof SubstantiationResolutionSchema>;
