import { z } from "zod";

export const HandoffReasonSchema = z.enum([
  "human_requested",
  "max_turns_exceeded",
  "complex_objection",
  "negative_sentiment",
  "compliance_concern",
  "booking_failure",
  "escalation_timeout",
  "missing_knowledge",
  "outside_whatsapp_window",
]);
export type HandoffReason = z.infer<typeof HandoffReasonSchema>;

export const HandoffStatusSchema = z.enum(["pending", "assigned", "active", "released"]);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

export const LeadSnapshotSchema = z.object({
  leadId: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  serviceInterest: z.string().optional(),
  channel: z.string(),
  source: z.string().optional(),
});
export type LeadSnapshot = z.infer<typeof LeadSnapshotSchema>;

export const QualificationSnapshotSchema = z.object({
  signalsCaptured: z.record(z.string(), z.unknown()),
  qualificationStage: z.string(),
  leadScore: z.number().optional(),
});
export type QualificationSnapshot = z.infer<typeof QualificationSnapshotSchema>;

/**
 * The summary attached to a Handoff — keyed by turn count + key topics, not
 * to be confused with `ConversationSummary` in `./conversations.ts`, which is
 * a per-conversation projection used by the api's /conversations route. The
 * naming collision was resolved at hoist time per the PR-2 plan.
 */
export const HandoffConversationSummarySchema = z.object({
  turnCount: z.number().int(),
  keyTopics: z.array(z.string()),
  objectionHistory: z.array(z.string()),
  sentiment: z.string(),
  suggestedOpening: z.string().optional(),
});
export type HandoffConversationSummary = z.infer<typeof HandoffConversationSummarySchema>;

/**
 * Canonical Handoff shape — the package the chat layer constructs when an
 * agent escalates to a human, persisted to the `Handoff` Prisma row, surfaced
 * by `/api/escalations`, and consumed by the decisions adapter. Hoisted to
 * `@switchboard/schemas` per Route Governance Contract v1 §8.3; re-exported
 * from `packages/core` as `Handoff`.
 *
 * Date fields use `z.date()` (no coercion) per the PR-2 plan's Schema
 * boundary rule — Handoff is the in-process domain shape; serialised inputs
 * cross via mappers, not this schema.
 */
export const HandoffSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  organizationId: z.string(),
  reason: HandoffReasonSchema,
  status: HandoffStatusSchema,
  leadSnapshot: LeadSnapshotSchema,
  qualificationSnapshot: QualificationSnapshotSchema,
  conversationSummary: HandoffConversationSummarySchema,
  slaDeadlineAt: z.date(),
  createdAt: z.date(),
  acknowledgedAt: z.date().optional(),
});
export type Handoff = z.infer<typeof HandoffSchema>;
