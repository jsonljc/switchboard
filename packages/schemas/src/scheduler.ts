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
