import type { ToolCallRecord } from "./types.js";

interface TraceStoreForOutcomeLinker {
  linkOutcome(
    traceId: string,
    outcome: { id: string; type: "opportunity" | "task" | "campaign"; result: string },
  ): Promise<void>;
}

export class OutcomeLinker {
  constructor(private traceStore: TraceStoreForOutcomeLinker) {}

  async linkFromToolCalls(traceId: string, toolCalls: ToolCallRecord[]): Promise<void> {
    for (const call of toolCalls) {
      if (call.toolId === "crm-write" && call.operation === "stage.update") {
        const params = call.params as { opportunityId?: string };
        const stage = call.result.entityState?.stage as string | undefined;
        if (params.opportunityId && stage) {
          await this.traceStore.linkOutcome(traceId, {
            id: params.opportunityId,
            type: "opportunity",
            result: `stage_${stage}`,
          });
          return;
        }
      }

      if (call.toolId === "crm-write" && call.operation === "activity.log") {
        const params = call.params as { eventType?: string };
        if (params.eventType === "opt-out") {
          await this.traceStore.linkOutcome(traceId, {
            id: traceId,
            type: "task",
            result: "opt_out",
          });
          return;
        }
      }
    }
  }
}
