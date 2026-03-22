import { z } from "zod";

// ---------------------------------------------------------------------------
// Thread Stage — conversation progression (distinct from CRM lifecycle stage)
// ---------------------------------------------------------------------------

export const ThreadStageSchema = z.enum([
  "new",
  "responding",
  "qualifying",
  "qualified",
  "closing",
  "won",
  "lost",
  "nurturing",
]);
export type ThreadStage = z.infer<typeof ThreadStageSchema>;

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

export const SentimentTrendSchema = z.enum(["positive", "neutral", "negative", "unknown"]);
export type SentimentTrend = z.infer<typeof SentimentTrendSchema>;

// ---------------------------------------------------------------------------
// Agent Context Data — derived state accumulated over conversation turns
// ---------------------------------------------------------------------------

export const OfferMadeSchema = z.object({
  description: z.string(),
  date: z.coerce.date(),
});
export type OfferMade = z.infer<typeof OfferMadeSchema>;

export const AgentContextDataSchema = z.object({
  objectionsEncountered: z.array(z.string()).default([]),
  preferencesLearned: z.record(z.string()).default({}),
  offersMade: z.array(OfferMadeSchema).default([]),
  topicsDiscussed: z.array(z.string()).default([]),
  sentimentTrend: SentimentTrendSchema.default("unknown"),
});
export type AgentContextData = z.infer<typeof AgentContextDataSchema>;

// ---------------------------------------------------------------------------
// Follow-Up Schedule
// ---------------------------------------------------------------------------

export const FollowUpScheduleSchema = z.object({
  nextFollowUpAt: z.coerce.date().nullable(),
  reason: z.string().nullable(),
  cadenceId: z.string().nullable(),
});
export type FollowUpSchedule = z.infer<typeof FollowUpScheduleSchema>;

// ---------------------------------------------------------------------------
// ConversationThread — per-contact derived state (not message storage)
// ---------------------------------------------------------------------------

export const ConversationThreadSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  organizationId: z.string().min(1),
  stage: ThreadStageSchema,
  assignedAgent: z.string().min(1),
  agentContext: AgentContextDataSchema,
  currentSummary: z.string(),
  followUpSchedule: FollowUpScheduleSchema,
  lastOutcomeAt: z.coerce.date().nullable(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ConversationThread = z.infer<typeof ConversationThreadSchema>;
