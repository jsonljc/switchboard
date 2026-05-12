import type {
  ConversationLifecycleState,
  ConversationLifecycleTrigger,
} from "@switchboard/schemas";

export const STALLED_THRESHOLD_HOURS = 24;
export const RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS = 7;
export const CRON_LOOKBACK_HOURS = 168; // 7 days — bound the cron's candidate set

/**
 * 3a runtime allowlists. The schema defines the full Phase 3 enum for forward
 * compatibility; 3a code paths must only emit values from these sets.
 * Enforced at runtime by `LifecycleWriter` (see Task 7) and asserted by an
 * integration test (Task 16).
 */
export const THREE_A_ALLOWED_STATES = new Set<ConversationLifecycleState>([
  "active",
  "stalled",
  "booked",
  "escalated",
]);

export const THREE_A_ALLOWED_TRIGGERS = new Set<ConversationLifecycleTrigger>([
  "timer_24h_no_inbound",
  "inbound_after_stalled",
  "inbound_after_re_engagement_template",
  "booking_event_received",
  "governance_verdict_escalate",
  "operator_takeover",
]);
