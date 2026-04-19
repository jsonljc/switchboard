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
]);
export type DeploymentMemoryCategory = z.infer<typeof DeploymentMemoryCategorySchema>;

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
