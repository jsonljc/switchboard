import { z } from "zod";
import { AgentKeySchema } from "./agents.js";

export const RecommendationSurfaceSchema = z.enum(["queue", "shadow_action", "dropped"]);
export type RecommendationSurface = z.infer<typeof RecommendationSurfaceSchema>;

export const RecommendationStatusSchema = z.enum([
  "pending",
  "acted",
  "dismissed",
  "confirmed",
  "dismissed_by_undo",
  "expired",
]);
export type RecommendationStatus = z.infer<typeof RecommendationStatusSchema>;

export const RecommendationActionSchema = z.enum([
  "primary",
  "secondary",
  "dismiss",
  "confirm",
  "undo",
]);
export type RecommendationAction = z.infer<typeof RecommendationActionSchema>;

export { AgentKeySchema, type AgentKey } from "./agents.js";

export const RecommendationPresentationSchema = z.object({
  primaryLabel: z.string().min(1),
  secondaryLabel: z.string().min(1),
  dismissLabel: z.string().min(1),
  dataLines: z.array(z.unknown()),
  acceptToast: z.string().min(1).optional(),
  declineToast: z.string().min(1).optional(),
});
export type RecommendationPresentation = z.infer<typeof RecommendationPresentationSchema>;

export const RecommendationInputSchema = z.object({
  orgId: z.string().min(1),
  agentKey: AgentKeySchema,
  intent: z.string().regex(/^recommendation\./, "intent must start with 'recommendation.'"),
  // Domain-specific action identifier (e.g. "pause", "reduce_budget", "approve_lead").
  // Intentionally free-form — different emitters (ad-optimizer, creative-pipeline, etc.)
  // own their own action vocabularies. The router (packages/core/src/recommendations/router.ts)
  // decides which actions are reversible/auto-actionable. Constraining this to a single
  // enum here would couple recommendations to a single emitter and defeat the v1.5/v2
  // expansion path documented in the spec's "Operator UX Principles" section.
  action: z.string().min(1),
  humanSummary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  dollarsAtRisk: z.number().min(0),
  riskLevel: z.enum(["low", "medium", "high"]),
  parameters: z.record(z.unknown()),
  presentation: RecommendationPresentationSchema,
  targetEntities: z.record(z.unknown()).optional(),
  expiresAt: z.date().optional(),
  sourceWorkflow: z.string().optional(),
});
export type RecommendationInput = z.infer<typeof RecommendationInputSchema>;

export const ActOnRecommendationInputSchema = z.object({
  recommendationId: z.string().min(1),
  orgId: z.string().min(1),
  actor: z.object({
    principalId: z.string().min(1),
    type: z.literal("operator"),
  }),
  action: RecommendationActionSchema,
  note: z.string().optional(),
});
export type ActOnRecommendationInput = z.infer<typeof ActOnRecommendationInputSchema>;
