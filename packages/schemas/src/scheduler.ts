import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const TriggerTypeSchema = z.enum(["timer", "cron", "event_match"]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const TriggerStatusSchema = z.enum(["active", "fired", "cancelled", "expired"]);
export type TriggerStatus = z.infer<typeof TriggerStatusSchema>;

export const TERMINAL_TRIGGER_STATUSES: readonly TriggerStatus[] = [
  "fired",
  "cancelled",
  "expired",
];

export const TriggerActionTypeSchema = z.enum(["spawn_workflow", "resume_workflow", "emit_event"]);
export type TriggerActionType = z.infer<typeof TriggerActionTypeSchema>;

// ---------------------------------------------------------------------------
// Trigger Action
// ---------------------------------------------------------------------------

export const TriggerActionSchema = z.object({
  type: TriggerActionTypeSchema,
  payload: z.record(z.unknown()),
});
export type TriggerAction = z.infer<typeof TriggerActionSchema>;

// ---------------------------------------------------------------------------
// Event Pattern (for event_match triggers)
// ---------------------------------------------------------------------------

export const EventPatternSchema = z.object({
  type: z.string(),
  filters: z.record(z.unknown()),
});
export type EventPattern = z.infer<typeof EventPatternSchema>;

// ---------------------------------------------------------------------------
// Trigger Filters (query parameters for listing triggers)
// ---------------------------------------------------------------------------

export const TriggerFiltersSchema = z
  .object({
    organizationId: z.string(),
    status: TriggerStatusSchema,
    type: TriggerTypeSchema,
    sourceWorkflowId: z.string(),
  })
  .partial();
export type TriggerFilters = z.infer<typeof TriggerFiltersSchema>;

// ---------------------------------------------------------------------------
// Scheduled Trigger
// ---------------------------------------------------------------------------

export const ScheduledTriggerSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    type: TriggerTypeSchema,
    fireAt: z.coerce.date().nullable(),
    cronExpression: z.string().nullable(),
    eventPattern: EventPatternSchema.nullable(),
    action: TriggerActionSchema,
    sourceWorkflowId: z.string().nullable(),
    status: TriggerStatusSchema,
    createdAt: z.coerce.date(),
    expiresAt: z.coerce.date().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "timer" && data.fireAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timer trigger requires fireAt",
        path: ["fireAt"],
      });
    }
    if (data.type === "cron" && data.cronExpression === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cron trigger requires cronExpression",
        path: ["cronExpression"],
      });
    }
    if (data.type === "event_match" && data.eventPattern === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "event_match trigger requires eventPattern",
        path: ["eventPattern"],
      });
    }
  });
export type ScheduledTrigger = z.infer<typeof ScheduledTriggerSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// D2 — /automations browse projection (page-ready, surface-agnostic).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row in the /automations Mercury list.
 *
 * Hard invariant: never carries `action.payload` values. The drawer surfaces
 * an allowlisted subset of payload key names plus a `redactedKeyCount`.
 */
export const ScheduledTriggerBrowseRowSchema = z.object({
  id: z.string(),
  type: TriggerTypeSchema,
  status: TriggerStatusSchema,
  // Derived display label — see core/list-triggers.ts. Defensive fallbacks
  // ("cron:unknown" etc.) keep malformed legacy rows from crashing the page.
  scheduleLabel: z.string(),
  actionType: TriggerActionTypeSchema,
  sourceWorkflowId: z.string().nullable(),
  createdAt: z.string().datetime(),
  fireAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  drawer: z.object({
    eventPatternSummary: z.string().nullable(),
    visibleActionPayloadKeys: z.array(z.string()),
    redactedKeyCount: z.number().int().min(0),
  }),
});
export type ScheduledTriggerBrowseRow = z.infer<typeof ScheduledTriggerBrowseRowSchema>;

/**
 * Query for `GET /api/dashboard/automations`. No `type` filter in v1
 * (cut for YAGNI per spec §2.0 #6); no `search` in v1; only `createdAt` sort.
 */
export const ScheduledTriggersListQuerySchema = z.object({
  status: TriggerStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(["createdAt"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export type ScheduledTriggersListQuery = z.infer<typeof ScheduledTriggersListQuerySchema>;

export const TriggerStatusCountsSchema = z.object({
  all: z.number().int().min(0),
  active: z.number().int().min(0),
  fired: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  expired: z.number().int().min(0),
});
export type TriggerStatusCounts = z.infer<typeof TriggerStatusCountsSchema>;

export const ScheduledTriggersListResponseSchema = z.object({
  rows: z.array(ScheduledTriggerBrowseRowSchema),
  // Counts reflect persisted ScheduledTriggerRecord rows only — reaped rows
  // (deleted by TriggerStore.deleteExpired) are not surfaced. D2 doesn't
  // recompute expiry state.
  statusCounts: TriggerStatusCountsSchema,
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ScheduledTriggersListResponse = z.infer<typeof ScheduledTriggersListResponseSchema>;
