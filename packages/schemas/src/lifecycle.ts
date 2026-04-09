import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ContactStageSchema = z.enum(["new", "active", "customer", "retained", "dormant"]);
export type ContactStage = z.infer<typeof ContactStageSchema>;

export const OpportunityStageSchema = z.enum([
  "interested",
  "qualified",
  "quoted",
  "booked",
  "showed",
  "won",
  "lost",
  "nurturing",
]);
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

export const TERMINAL_OPPORTUNITY_STAGES: OpportunityStage[] = ["won", "lost"];

export const ThreadStatusSchema = z.enum([
  "open",
  "waiting_on_customer",
  "waiting_on_business",
  "stale",
  "closed",
]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "dismissed"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskTypeSchema = z.enum([
  "fallback_handoff",
  "approval_required",
  "manual_action",
  "review_needed",
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const RevenueTypeSchema = z.enum(["payment", "deposit", "invoice", "refund"]);
export type RevenueType = z.infer<typeof RevenueTypeSchema>;

export const RevenueStatusSchema = z.enum(["pending", "confirmed", "refunded", "failed"]);
export type RevenueStatus = z.infer<typeof RevenueStatusSchema>;

export const RecordedBySchema = z.enum(["owner", "staff", "stripe", "integration"]);
export type RecordedBy = z.infer<typeof RecordedBySchema>;

export const FallbackReasonSchema = z.enum(["not_configured", "paused", "errored"]);
export type FallbackReason = z.infer<typeof FallbackReasonSchema>;

// ---------------------------------------------------------------------------
// Attribution Chain
// ---------------------------------------------------------------------------

export const AttributionChainSchema = z.object({
  fbclid: z.string().nullable(),
  gclid: z.string().nullable(),
  ttclid: z.string().nullable(),
  sourceCampaignId: z.string().nullable(),
  sourceAdId: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
});
export type AttributionChain = z.infer<typeof AttributionChainSchema>;

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export const ContactSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  primaryChannel: z.enum(["whatsapp", "telegram", "dashboard"]),
  firstTouchChannel: z.string().nullable().optional(),
  stage: ContactStageSchema.default("new"),
  source: z.string().nullable().optional(),
  attribution: AttributionChainSchema.nullable().optional(),
  roles: z.array(z.string()).default(["lead"]),
  qualificationData: z.record(z.unknown()).nullable().optional(),
  firstContactAt: z.coerce.date(),
  lastActivityAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Contact = z.infer<typeof ContactSchema>;

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

export const ObjectionRecordSchema = z.object({
  category: z.string(),
  raisedAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable(),
});
export type ObjectionRecord = z.infer<typeof ObjectionRecordSchema>;

export const OpportunitySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  contactId: z.string().min(1),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  stage: OpportunityStageSchema.default("interested"),
  timeline: z.enum(["immediate", "soon", "exploring", "unknown"]).optional(),
  priceReadiness: z.enum(["ready", "flexible", "price_sensitive", "unknown"]).optional(),
  objections: z.array(ObjectionRecordSchema).default([]),
  qualificationComplete: z.boolean().default(false),
  estimatedValue: z.number().int().nullable().optional(),
  revenueTotal: z.number().int().default(0),
  assignedAgent: z.string().nullable().optional(),
  assignedStaff: z.string().nullable().optional(),
  lostReason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  openedAt: z.coerce.date(),
  closedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

// ---------------------------------------------------------------------------
// Lifecycle Revenue Event
// ---------------------------------------------------------------------------

export const LifecycleRevenueEventSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  contactId: z.string().min(1),
  opportunityId: z.string().min(1),
  amount: z.number().int(),
  currency: z.string().length(3).default("SGD"),
  type: RevenueTypeSchema,
  status: RevenueStatusSchema.default("confirmed"),
  recordedBy: RecordedBySchema,
  externalReference: z.string().nullable().optional(),
  verified: z.boolean().default(false),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
  recordedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type LifecycleRevenueEvent = z.infer<typeof LifecycleRevenueEventSchema>;

// ---------------------------------------------------------------------------
// Owner Task
// ---------------------------------------------------------------------------

export const OwnerTaskSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  contactId: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
  type: TaskTypeSchema,
  title: z.string().min(1),
  description: z.string(),
  suggestedAction: z.string().nullable().optional(),
  status: TaskStatusSchema.default("pending"),
  priority: TaskPrioritySchema.default("medium"),
  triggerReason: z.string().min(1),
  sourceAgent: z.string().nullable().optional(),
  fallbackReason: FallbackReasonSchema.nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type OwnerTask = z.infer<typeof OwnerTaskSchema>;

// ---------------------------------------------------------------------------
// Stage Handler Map Config (used by routing + fallback)
// ---------------------------------------------------------------------------

export const StageHandlerConfigSchema = z.object({
  preferredAgent: z.union([z.string(), z.array(z.string())]).nullable(),
  fallbackType: z.enum(["fallback_handoff", "none"]),
});
export type StageHandlerConfig = z.infer<typeof StageHandlerConfigSchema>;

// ---------------------------------------------------------------------------
// Pipeline Snapshot (query result for dashboard)
// ---------------------------------------------------------------------------

export const PipelineStageCountSchema = z.object({
  stage: OpportunityStageSchema,
  count: z.number().int().nonnegative(),
  totalValue: z.number().int().nonnegative(),
});
export type PipelineStageCount = z.infer<typeof PipelineStageCountSchema>;

export const PipelineSnapshotSchema = z.object({
  organizationId: z.string().min(1),
  stages: z.array(PipelineStageCountSchema),
  totalContacts: z.number().int().nonnegative(),
  totalRevenue: z.number().int().nonnegative(),
  generatedAt: z.coerce.date(),
});
export type PipelineSnapshot = z.infer<typeof PipelineSnapshotSchema>;
