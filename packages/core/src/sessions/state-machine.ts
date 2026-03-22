import type { SessionStatus } from "@switchboard/schemas";

/**
 * Session state transition table.
 *
 * running   → paused, completed, failed, cancelled
 * paused    → running (resume), cancelled
 * completed → (terminal)
 * failed    → (terminal)
 * cancelled → (terminal)
 *
 * Notable: paused → failed is NOT allowed. A paused session can only be
 * cancelled (deliberate) or resumed (then it may fail during the next run).
 * paused → completed is NOT allowed — must resume first.
 */
export const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class SessionTransitionError extends Error {
  constructor(
    public readonly from: SessionStatus,
    public readonly to: SessionStatus,
  ) {
    super(
      `Invalid session transition: cannot move from '${from}' to '${to}'. ` +
        `Valid transitions from '${from}': [${VALID_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
    );
    this.name = "SessionTransitionError";
  }
}

/**
 * Check if a state transition is valid.
 */
export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Validate a transition with a reason for rejection.
 */
export function validateTransition(
  from: SessionStatus,
  to: SessionStatus,
): { valid: true } | { valid: false; reason: string } {
  if (canTransition(from, to)) {
    return { valid: true };
  }
  return {
    valid: false,
    reason:
      `Cannot transition from '${from}' to '${to}'. ` +
      `Valid transitions from '${from}': [${VALID_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
  };
}
