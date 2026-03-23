import type { WorkflowStatus } from "@switchboard/schemas";
import { TERMINAL_WORKFLOW_STATUSES } from "@switchboard/schemas";

export const VALID_WORKFLOW_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  pending: ["running", "cancelled"],
  running: [
    "awaiting_approval",
    "awaiting_event",
    "scheduled",
    "blocked",
    "completed",
    "failed",
    "cancelled",
  ],
  awaiting_approval: ["running", "cancelled"],
  awaiting_event: ["running", "failed"],
  scheduled: ["running", "cancelled"],
  blocked: ["running", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class WorkflowTransitionError extends Error {
  constructor(
    public readonly from: WorkflowStatus,
    public readonly to: WorkflowStatus,
  ) {
    super(
      `Invalid workflow transition: cannot move from '${from}' to '${to}'. Valid transitions from '${from}': [${VALID_WORKFLOW_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
    );
    this.name = "WorkflowTransitionError";
  }
}

export function canWorkflowTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return VALID_WORKFLOW_TRANSITIONS[from].includes(to);
}

export function validateWorkflowTransition(
  from: WorkflowStatus,
  to: WorkflowStatus,
): { valid: true } | { valid: false; reason: string } {
  if (canWorkflowTransition(from, to)) return { valid: true };
  return {
    valid: false,
    reason: `Cannot transition from '${from}' to '${to}'. Valid transitions from '${from}': [${VALID_WORKFLOW_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
  };
}

export function isTerminalStatus(status: WorkflowStatus): boolean {
  return TERMINAL_WORKFLOW_STATUSES.includes(status);
}
