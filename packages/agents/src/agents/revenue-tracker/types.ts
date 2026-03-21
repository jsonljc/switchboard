// ---------------------------------------------------------------------------
// Revenue Tracker — Dependency types
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the Revenue Tracker handler.
 */
export interface RevenueTrackerDeps {
  /**
   * Notify owner when an offline conversion permanently fails.
   * When true, emits messaging.escalation.notify_owner action on dead letter.
   */
  alertOnDeadLetter?: boolean;
}
