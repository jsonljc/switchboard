import { z } from "zod";

// `disqualified` is forward-compatible — defined here for schema stability
// across 3a → 3b → 3c. **3a code paths MUST NOT emit `disqualified`.**
// See `LifecycleWriter`'s 3a allowlist guard (Task 7) and the
// `THREE_A_ALLOWED_*` constants in `packages/core/src/conversation-lifecycle/constants.ts`.
export const ConversationLifecycleStateSchema = z.enum([
  "active",
  "qualified",
  "stalled",
  "booked",
  "disqualified",
  "escalated",
]);
export type ConversationLifecycleState = z.infer<typeof ConversationLifecycleStateSchema>;

// `proposed_disqualified` is forward-compatible — 3a never sets it.
// 3b introduces operator-confirmed disqualification flow.
export const LifecycleQualificationStatusSchema = z.enum([
  "unknown",
  "unqualified",
  "qualified",
  "proposed_disqualified",
]);
export type LifecycleQualificationStatus = z.infer<typeof LifecycleQualificationStatusSchema>;

export const LifecycleBookingStatusSchema = z.enum(["not_booked", "booked"]);
export type LifecycleBookingStatus = z.infer<typeof LifecycleBookingStatusSchema>;

export const LifecycleDropoffReasonSchema = z
  .enum([
    "no_reply",
    "explicit_decline",
    "price_objection",
    "out_of_area",
    "wrong_treatment",
    "operator_marked_not_ready",
  ])
  .nullable();
export type LifecycleDropoffReason = z.infer<typeof LifecycleDropoffReasonSchema>;

// Triggers tagged "3b only" or "3c only" are forward-compatible — 3a code
// must never construct a transition with one of those triggers. See
// THREE_A_ALLOWED_TRIGGERS in constants.ts and the writer's runtime guard.
export const ConversationLifecycleTriggerSchema = z.enum([
  // 3a triggers
  "timer_24h_no_inbound",
  "inbound_after_stalled",
  "inbound_after_re_engagement_template",
  "booking_event_received",
  "governance_verdict_escalate",
  "operator_takeover",
  // 3b triggers (forward-compatible — NOT emitted in 3a)
  "qualification_checklist_met",
  "qualification_checklist_failed",
  "system_proposed_disqualification",
  "operator_confirmed_disqualification",
  "operator_dismissed_disqualification",
]);
export type ConversationLifecycleTrigger = z.infer<typeof ConversationLifecycleTriggerSchema>;

export const ConversationLifecycleActorSchema = z.enum([
  "system",
  "alex",
  "operator",
  "integration",
]);
export type ConversationLifecycleActor = z.infer<typeof ConversationLifecycleActorSchema>;

export const ConversationLifecycleSnapshotSchema = z.object({
  conversationThreadId: z.string(),
  organizationId: z.string(),
  contactId: z.string(),
  currentState: ConversationLifecycleStateSchema,
  qualificationStatus: LifecycleQualificationStatusSchema,
  bookingStatus: LifecycleBookingStatusSchema,
  dropoffReason: LifecycleDropoffReasonSchema,
  lastTransitionAt: z.date(),
  lastEvaluatedAt: z.date(),
  updatedAt: z.date(),
});
export type ConversationLifecycleSnapshot = z.infer<typeof ConversationLifecycleSnapshotSchema>;

export const ConversationLifecycleTransitionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  conversationThreadId: z.string(),
  contactId: z.string(),
  fromState: ConversationLifecycleStateSchema.nullable(),
  toState: ConversationLifecycleStateSchema,
  trigger: ConversationLifecycleTriggerSchema,
  evidence: z.record(z.unknown()),
  actor: ConversationLifecycleActorSchema,
  workTraceId: z.string().nullable(),
  occurredAt: z.date(),
});
export type ConversationLifecycleTransition = z.infer<typeof ConversationLifecycleTransitionSchema>;

// Highest precedence first. The cron and event hooks must respect this order.
export const LIFECYCLE_STATE_PRECEDENCE = [
  "booked",
  "disqualified",
  "escalated",
  "stalled",
  "qualified",
  "active",
] as const satisfies readonly ConversationLifecycleState[];

export function compareLifecyclePrecedence(
  a: ConversationLifecycleState,
  b: ConversationLifecycleState,
): number {
  return LIFECYCLE_STATE_PRECEDENCE.indexOf(a) - LIFECYCLE_STATE_PRECEDENCE.indexOf(b);
}
