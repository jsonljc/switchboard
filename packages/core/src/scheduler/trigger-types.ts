import type { TriggerStatus, ScheduledTrigger } from "@switchboard/schemas";

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

/**
 * Filter active event_match triggers that match a given event type and data.
 * Shared between core SchedulerService and BullMQ adapter to avoid duplication.
 */
export function filterMatchingTriggers(
  candidates: ScheduledTrigger[],
  eventType: string,
  eventData: Record<string, unknown>,
): ScheduledTrigger[] {
  return candidates.filter((trigger) => {
    if (!trigger.eventPattern) return false;
    if (trigger.eventPattern.type !== eventType) return false;

    for (const [key, value] of Object.entries(trigger.eventPattern.filters)) {
      if (eventData[key] !== value) return false;
    }
    return true;
  });
}
