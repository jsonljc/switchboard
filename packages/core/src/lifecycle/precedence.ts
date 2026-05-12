import {
  type ConversationLifecycleState,
  LIFECYCLE_STATE_PRECEDENCE,
  compareLifecyclePrecedence,
} from "@switchboard/schemas";

export { LIFECYCLE_STATE_PRECEDENCE, compareLifecyclePrecedence };

/**
 * Encodes spec §4.3 transition rules:
 * - `booked` and `disqualified` are terminal except via operator action.
 * - `escalated` is operationally terminal for Alex but allows `escalated → booked`
 *   when the operator closes a booking after takeover.
 * - `null → *` (initial transition for a thread with no snapshot) is restricted:
 *   only `active`, `booked`, `escalated` may seed a snapshot. `null → stalled`
 *   is forbidden — the cron must not invent a stalled snapshot from nothing;
 *   thread-init runs first via `onThreadFirstObservation`. `null → qualified`
 *   and `null → disqualified` are forbidden because both require an active
 *   observation first (3b).
 */
const NULL_INIT_ALLOWED: ReadonlySet<ConversationLifecycleState> = new Set([
  "active",
  "booked",
  "escalated",
]);

export function canTransition(
  from: ConversationLifecycleState | null,
  to: ConversationLifecycleState,
): boolean {
  if (from === null) return NULL_INIT_ALLOWED.has(to);
  if (from === "booked") return false;
  if (from === "disqualified") return false;
  if (from === "escalated" && to !== "booked") return false;
  return true;
}
