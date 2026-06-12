import type { ToolCallRecord } from "./types.js";
import type { LinkedOutcomeType } from "./types.js";

export interface LinkedOutcome {
  id: string;
  type: LinkedOutcomeType;
  result: string;
}

interface TraceStoreForOutcomeLinker {
  linkOutcome(organizationId: string, traceId: string, outcome: LinkedOutcome): Promise<void>;
}

/**
 * Derives the single business outcome a skill turn should be linked to, from its
 * tool calls. Priority: a successful booking (terminal conversion) wins over a
 * stage update, which wins over an opt-out. Pure and side-effect free so both the
 * post-turn OutcomeLinker and the always-invoked TracePersistenceHook can reuse it.
 */
export function deriveLinkedOutcome(
  toolCalls: ToolCallRecord[],
  traceId: string,
): LinkedOutcome | null {
  // Booking conversion is the strongest terminal outcome: scan for it first.
  for (const call of toolCalls) {
    if (
      call.toolId === "calendar-book" &&
      call.operation === "booking.create" &&
      call.result.status === "success"
    ) {
      const entityState = call.result.entityState as { bookingId?: unknown } | undefined;
      const bookingId = entityState?.bookingId;
      if (typeof bookingId === "string" && bookingId.length > 0) {
        return { id: bookingId, type: "booking", result: "booked" };
      }
    }
  }

  // Existing behavior, preserved: first call matching stage/opt-out wins.
  for (const call of toolCalls) {
    if (call.toolId === "crm-write" && call.operation === "stage.update") {
      const params = call.params as { opportunityId?: string };
      const stage = call.result.entityState?.stage as string | undefined;
      if (params.opportunityId && stage) {
        return { id: params.opportunityId, type: "opportunity", result: `stage_${stage}` };
      }
    }

    if (call.toolId === "crm-write" && call.operation === "activity.log") {
      const params = call.params as { eventType?: string };
      if (params.eventType === "opt-out") {
        return { id: traceId, type: "task", result: "opt_out" };
      }
    }
  }

  return null;
}

export class OutcomeLinker {
  constructor(private traceStore: TraceStoreForOutcomeLinker) {}

  async linkFromToolCalls(
    organizationId: string,
    traceId: string,
    toolCalls: ToolCallRecord[],
  ): Promise<void> {
    const outcome = deriveLinkedOutcome(toolCalls, traceId);
    if (outcome) {
      await this.traceStore.linkOutcome(organizationId, traceId, outcome);
    }
  }
}
