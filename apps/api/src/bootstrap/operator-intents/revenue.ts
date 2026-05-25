// apps/api/src/bootstrap/operator-intents/revenue.ts
// ---------------------------------------------------------------------------
// Phase 1b — operator.record_revenue handler factory (#654-B)
// ---------------------------------------------------------------------------
import type { RevenueStore } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { RecordRevenueParametersSchema } from "../../routes/operator-intents-schemas.js";

/** Minimal outbox-writer surface (concrete PrismaOutboxStore wired at bootstrap). */
export interface OutboxWriter {
  write(eventId: string, type: string, payload: Record<string, unknown>): Promise<void>;
}

export function buildRecordRevenueHandler(
  revenueStore: RevenueStore,
  outboxWriter: OutboxWriter,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RecordRevenueParametersSchema.parse(workUnit.parameters);
      const resolvedOpportunityId = params.opportunityId ?? `rev-${params.contactId}-${Date.now()}`;
      const event = await revenueStore.record({
        organizationId: workUnit.organizationId,
        contactId: params.contactId,
        opportunityId: resolvedOpportunityId,
        amount: params.amount,
        currency: params.currency,
        type: params.type,
        recordedBy: params.recordedBy,
        externalReference: params.externalReference ?? null,
        sourceCampaignId: params.sourceCampaignId ?? null,
        sourceAdId: params.sourceAdId ?? null,
      });
      await outboxWriter.write(`evt_rev_${event.id}`, "purchased", {
        type: "purchased",
        contactId: params.contactId,
        organizationId: workUnit.organizationId,
        value: params.amount,
        sourceAdId: params.sourceAdId ?? null,
        sourceCampaignId: params.sourceCampaignId ?? null,
        occurredAt: new Date().toISOString(),
        source: "revenue-api",
        metadata: {
          opportunityId: resolvedOpportunityId,
          currency: params.currency,
          revenueType: params.type,
        },
      });
      return {
        outcome: "completed" as const,
        summary: `Recorded ${params.type} of ${params.amount} ${params.currency} for contact ${params.contactId}`,
        outputs: { event },
      };
    },
  };
}
