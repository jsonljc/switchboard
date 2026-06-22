import { z } from "zod";

// ---------------------------------------------------------------------------
// Deployment Memory — schemas for three-tier agent memory system
// ---------------------------------------------------------------------------

export const DeploymentMemoryCategorySchema = z.enum([
  "preference",
  "faq",
  "objection",
  "pattern",
  "fact",
  // Slice-2 creative-loop categories. `taste` = the operator's subjective
  // Keep/Pass judgment, written ONLY by the creative-taste-sweep cron.
  // `revenue_proven` = attributed-performance promotion, Riley-owned writer
  // ONLY (designed in the slice-2 spec section 3.7; built when its trigger
  // fires: the first measured creative with spend > 0). Conversation
  // extraction must never emit either; the extractor prompt pins the legacy
  // five (see extraction-prompts + its category pin test).
  "taste",
  "revenue_proven",
]);
export type DeploymentMemoryCategory = z.infer<typeof DeploymentMemoryCategorySchema>;

/**
 * Provenance of a DeploymentMemory write — who/what asserted the fact. Set at
 * create time (and on resurrection of a tombstoned row); reinforcement never
 * mutates it. "operator" + "decay" are reserved for the governed writers landing
 * in S8b/S8c. Mirrors `category`: a Prisma String validated by a Zod enum (the
 * Prisma column is `source String?`).
 */
export const DeploymentMemorySourceSchema = z.enum([
  "conversation-compounding",
  "pattern-merge",
  "operator",
  "decay",
]);
export type DeploymentMemorySource = z.infer<typeof DeploymentMemorySourceSchema>;

export const InteractionOutcomeSchema = z.enum([
  "booked",
  "qualified",
  "lost",
  "info_request",
  "escalated",
]);
export type InteractionOutcome = z.infer<typeof InteractionOutcomeSchema>;

export const ExtractedFactSchema = z.object({
  fact: z.string(),
  confidence: z.number().min(0).max(1),
  category: DeploymentMemoryCategorySchema,
});
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

export const InteractionSummarySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  deploymentId: z.string().min(1),
  channelType: z.string().min(1),
  contactId: z.string().nullable().default(null),
  summary: z.string(),
  outcome: InteractionOutcomeSchema,
  extractedFacts: z.array(ExtractedFactSchema).default([]),
  questionsAsked: z.array(z.string()).default([]),
  duration: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
});
export type InteractionSummary = z.infer<typeof InteractionSummarySchema>;

export const DeploymentMemorySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  deploymentId: z.string().min(1),
  category: DeploymentMemoryCategorySchema,
  content: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  sourceCount: z.number().int().positive().default(1),
  lastSeenAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // Provenance + bi-temporal valid-time (S8a). All nullable/optional: legacy
  // rows + non-compounding writers leave them null. invalidatedAt IS NULL is the
  // liveness predicate; validTo is the valid-time end (set together in the
  // automatic evict/decay paths).
  source: DeploymentMemorySourceSchema.nullable().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
  invalidatedAt: z.coerce.date().nullable().optional(),
});
export type DeploymentMemory = z.infer<typeof DeploymentMemorySchema>;

export const ConfidenceFormulaSchema = z.object({
  sourceCount: z.number().int().positive(),
  ownerConfirmed: z.boolean(),
});

/**
 * confidence = ownerConfirmed ? 1.0 : min(0.95, 0.5 + 0.15 * ln(sourceCount))
 */
export function computeConfidenceScore(sourceCount: number, ownerConfirmed: boolean): number {
  if (ownerConfirmed) return 1.0;
  return Math.min(0.95, 0.5 + 0.15 * Math.log(sourceCount));
}

/** Memory is surfaced to customers only when it meets this threshold. */
export const SURFACING_THRESHOLD = { minSourceCount: 3, minConfidence: 0.66 } as const;

/** Max entries per deployment before oldest low-confidence entries are pruned. */
export const MAX_DEPLOYMENT_MEMORY_ENTRIES = 500;

/** Days without being seen before confidence decays by 0.1. */
export const DECAY_WINDOW_DAYS = 90;
export const PATTERN_DECAY_WINDOW_DAYS = 180;

/**
 * Two-stage merge threshold for outcome patterns (PR-3.2b).
 *
 * Conservative starting value. Lowering to 0.80 or 0.78 is the ratchet
 * path after the cross-key collision counter and rejection queue confirm
 * the canonical enum is well-calibrated (~4 weeks of pilot data minimum).
 * The legacy 0.92 SIMILARITY_THRESHOLD remains in compounding-service for
 * facts/FAQs and for the cross-key collision inspection counter.
 */
export const OUTCOME_PATTERN_MERGE_THRESHOLD = 0.84;
