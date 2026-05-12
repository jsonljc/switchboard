import type {
  ConversationLifecycleState,
  ConversationLifecycleTrigger,
} from "@switchboard/schemas";
import type { LifecycleWriteCapability } from "./types.js";

export const STALLED_THRESHOLD_HOURS = 24;
export const RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS = 7;
export const CRON_LOOKBACK_HOURS = 168; // 7 days — bound the cron's candidate set

export const MECHANICAL_ALLOWED_STATES = new Set<ConversationLifecycleState>([
  "active",
  "stalled",
  "booked",
  "escalated",
]);

export const MECHANICAL_ALLOWED_TRIGGERS = new Set<ConversationLifecycleTrigger>([
  "timer_24h_no_inbound",
  "inbound_after_stalled",
  "inbound_after_re_engagement_template",
  "booking_event_received",
  "governance_verdict_escalate",
  "operator_takeover",
]);

/**
 * Qualification capability adds `qualified` and `disqualified` as
 * advance-able currentState values, and the five qualification triggers.
 * `proposed_disqualified` is intentionally NOT here — it's a
 * qualificationStatus value, not a currentState value (see
 * LifecycleWriter.updateQualificationStatus, Task 7).
 */
export const QUALIFICATION_ALLOWED_STATES = new Set<ConversationLifecycleState>([
  "qualified",
  "disqualified",
]);

export const QUALIFICATION_ALLOWED_TRIGGERS = new Set<ConversationLifecycleTrigger>([
  "qualification_checklist_met",
  "qualification_checklist_failed",
  "system_proposed_disqualification",
  "operator_confirmed_disqualification",
  "operator_dismissed_disqualification",
]);

const STATES_BY_CAPABILITY: Record<LifecycleWriteCapability, Set<ConversationLifecycleState>> = {
  mechanical: MECHANICAL_ALLOWED_STATES,
  qualification: QUALIFICATION_ALLOWED_STATES,
};

const TRIGGERS_BY_CAPABILITY: Record<
  LifecycleWriteCapability,
  Set<ConversationLifecycleTrigger>
> = {
  mechanical: MECHANICAL_ALLOWED_TRIGGERS,
  qualification: QUALIFICATION_ALLOWED_TRIGGERS,
};

export function allowedStatesFor(
  capabilities: ReadonlySet<LifecycleWriteCapability>,
): Set<ConversationLifecycleState> {
  const merged = new Set<ConversationLifecycleState>();
  for (const c of capabilities) for (const s of STATES_BY_CAPABILITY[c]) merged.add(s);
  return merged;
}

export function allowedTriggersFor(
  capabilities: ReadonlySet<LifecycleWriteCapability>,
): Set<ConversationLifecycleTrigger> {
  const merged = new Set<ConversationLifecycleTrigger>();
  for (const c of capabilities) for (const t of TRIGGERS_BY_CAPABILITY[c]) merged.add(t);
  return merged;
}
