// ---------------------------------------------------------------------------
// Notification Classifier — event type + metadata → T1/T2/T3 tier
// ---------------------------------------------------------------------------

export type NotificationTier = "T1" | "T2" | "T3";

export type TrustLevel = "observe" | "guarded" | "autonomous";

export type NotificationEventType =
  | "pending_approval"
  | "action_failed"
  | "escalation"
  | "revenue_event"
  | "fact_learned"
  | "faq_drafted"
  | "agent_contradicted"
  | "weekly_summary"
  | "milestone"
  | "performance_stats";

export interface NotificationEvent {
  type: NotificationEventType;
  deploymentId: string;
  metadata: Record<string, unknown>;
}

const T1_EVENTS: ReadonlySet<string> = new Set([
  "pending_approval",
  "action_failed",
  "escalation",
  "revenue_event",
]);

const T2_EVENTS: ReadonlySet<string> = new Set([
  "fact_learned",
  "faq_drafted",
  "agent_contradicted",
]);

/**
 * Classify a notification event into a tier.
 *
 * Trust level modifiers affect T2 events only:
 * - `observe`: upgrades T2 → T1 (owner sees everything)
 * - `autonomous`: downgrades T2 → T3 (facts auto-confirm)
 *
 * T1 events are never downgraded. The trust graduation table in the spec
 * (Section 4.3) describes what TRIGGERS T1 events upstream (e.g., at
 * `autonomous`, fewer actions generate `pending_approval`). Once a T1 event
 * fires, it's always urgent regardless of trust level.
 *
 * @param event - The notification event to classify
 * @param trustLevel - Optional trust level modifier (defaults to "guarded")
 * @returns The notification tier: T1 (Act Now), T2 (Confirm), T3 (FYI)
 */
export function classifyNotification(
  event: NotificationEvent,
  trustLevel: TrustLevel = "guarded",
): NotificationTier {
  // Base classification from event type
  let tier: NotificationTier;
  if (T1_EVENTS.has(event.type)) {
    tier = "T1";
  } else if (T2_EVENTS.has(event.type)) {
    tier = "T2";
  } else {
    tier = "T3";
  }

  // Trust level modifiers
  if (trustLevel === "observe" && tier === "T2") {
    return "T1";
  }

  if (trustLevel === "autonomous" && tier === "T2") {
    return "T3";
  }

  return tier;
}
