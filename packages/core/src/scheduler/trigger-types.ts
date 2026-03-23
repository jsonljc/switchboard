import type { TriggerStatus } from "@switchboard/schemas";

export const VALID_TRIGGER_TRANSITIONS: Record<TriggerStatus, readonly TriggerStatus[]> = {
  active: ["fired", "cancelled", "expired"],
  fired: [],
  cancelled: [],
  expired: [],
};

export function canTriggerTransition(from: TriggerStatus, to: TriggerStatus): boolean {
  return VALID_TRIGGER_TRANSITIONS[from].includes(to);
}

export class TriggerTransitionError extends Error {
  constructor(
    public readonly from: TriggerStatus,
    public readonly to: TriggerStatus,
  ) {
    super(`Invalid trigger transition: ${from} -> ${to}`);
    this.name = "TriggerTransitionError";
  }
}

export function validateTriggerTransition(from: TriggerStatus, to: TriggerStatus): void {
  if (!canTriggerTransition(from, to)) {
    throw new TriggerTransitionError(from, to);
  }
}

export function isTerminalTriggerStatus(status: TriggerStatus): boolean {
  return VALID_TRIGGER_TRANSITIONS[status].length === 0;
}
