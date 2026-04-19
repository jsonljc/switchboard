import { z } from "zod";

// ---------------------------------------------------------------------------
// Trust Levels — observe / guarded / autonomous
// ---------------------------------------------------------------------------

export const TrustLevelSchema = z.enum(["observe", "guarded", "autonomous"]);
export type TrustLevel = z.infer<typeof TrustLevelSchema>;

// ---------------------------------------------------------------------------
// Notification Tiers — T1 (act now) / T2 (confirm) / T3 (FYI)
// ---------------------------------------------------------------------------

export const NotificationTierSchema = z.enum(["T1", "T2", "T3"]);
export type NotificationTier = z.infer<typeof NotificationTierSchema>;

// ---------------------------------------------------------------------------
// Agent Event — database-backed event bus
// ---------------------------------------------------------------------------

export const AgentEventStatusSchema = z.enum([
  "pending",
  "processing",
  "done",
  "failed",
  "dead_letter",
]);
export type AgentEventStatus = z.infer<typeof AgentEventStatusSchema>;

export const AgentEventSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  deploymentId: z.string(),
  eventType: z.string(),
  payload: z.record(z.unknown()),
  status: AgentEventStatusSchema.default("pending"),
  retryCount: z.number().int().min(0),
  createdAt: z.coerce.date(),
  processedAt: z.coerce.date().nullable().optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ---------------------------------------------------------------------------
// Activity Log — runtime activity diary
// ---------------------------------------------------------------------------

export const ActivityLogEventTypeSchema = z.enum([
  "fact_learned",
  "fact_decayed",
  "faq_drafted",
  "faq_promoted",
  "summary_created",
  "correction_applied",
  "memory_deleted",
  "consolidation_run",
]);
export type ActivityLogEventType = z.infer<typeof ActivityLogEventTypeSchema>;

export const ActivityLogSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  deploymentId: z.string(),
  eventType: ActivityLogEventTypeSchema,
  description: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.coerce.date(),
});
export type ActivityLogEntry = z.infer<typeof ActivityLogSchema>;

// ---------------------------------------------------------------------------
// Draft FAQ — fields on KnowledgeChunk
// ---------------------------------------------------------------------------

export const DraftStatusSchema = z.enum(["pending", "approved"]).nullable();
export type DraftStatus = z.infer<typeof DraftStatusSchema>;
