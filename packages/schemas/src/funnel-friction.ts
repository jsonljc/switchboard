// packages/schemas/src/funnel-friction.ts
import { z } from "zod";

export const FrictionType = z.enum([
  "low_trust",
  "price_shock",
  "expectation_mismatch",
  "weak_hook",
  "offer_confusion",
  "low_urgency",
  "weak_demo",
  "poor_social_proof",
]);
export type FrictionType = z.infer<typeof FrictionType>;

export const FrictionConfidence = z.enum(["low", "medium", "high"]);
export type FrictionConfidence = z.infer<typeof FrictionConfidence>;

export const FrictionSource = z.enum([
  "crm",
  "chat",
  "sales_agent",
  "ads",
  "call_review",
  "manual",
]);
export type FrictionSource = z.infer<typeof FrictionSource>;

export const FunnelFrictionSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  frictionType: FrictionType,
  source: FrictionSource,
  confidence: FrictionConfidence,
  evidenceCount: z.number().int().min(0),
  firstSeenAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  notes: z.array(z.string()).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type FunnelFriction = z.infer<typeof FunnelFrictionSchema>;

export const CreativeWeightsSchema = z.object({
  structurePriorities: z.record(z.number()),
  motivatorPriorities: z.record(z.number()),
  scriptConstraints: z.array(z.string()),
  hookDirectives: z.array(z.string()),
});
export type CreativeWeights = z.infer<typeof CreativeWeightsSchema>;
