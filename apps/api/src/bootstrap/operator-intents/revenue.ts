// apps/api/src/bootstrap/operator-intents/revenue.ts
// ---------------------------------------------------------------------------
// Phase 1b — operator.record_revenue handler factory (#654-B)
// PR-2 (#677) — wraps domain write + outbox write in a single transaction
// ---------------------------------------------------------------------------
import type { RevenueStore, StoreTransactionContext } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { RecordRevenueParametersSchema } from "../../routes/operator-intents-schemas.js";

/** Minimal outbox-writer surface (concrete PrismaOutboxStore wired at bootstrap). */
export interface OutboxWriter {
  write(
    eventId: string,
    type: string,
    payload: Record<string, unknown>,
    tx?: StoreTransactionContext,
  ): Promise<void>;
}

/**
 * App-layer transaction runner injected at bootstrap.
 * In production: `(fn) => prisma.$transaction((tx) => fn(tx))`.
 * In tests: `async (fn) => fn(undefined)` (no-op sentinel).
 */
export type RunInTransaction = <T>(fn: (tx: StoreTransactionContext) => Promise<T>) => Promise<T>;

export function buildRecordRevenueHandler(
  revenueStore: RevenueStore,
  outboxWriter: OutboxWriter,
  runInTransaction: RunInTransaction,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RecordRevenueParametersSchema.parse(workUnit.parameters);
      const resolvedOpportunityId = params.opportunityId ?? `rev-${params.contactId}-${Date.now()}`;

      const event = await runInTransaction(async (tx) => {
        const created = await revenueStore.record(
          {
            organizationId: workUnit.organizationId,
            contactId: params.contactId,
            opportunityId: resolvedOpportunityId,
            amount: params.amount,
            currency: params.currency,
            type: params.type,
            recordedBy: params.recordedBy,
            verified: false,
            externalReference: params.externalReference ?? null,
            sourceCampaignId: params.sourceCampaignId ?? null,
            sourceAdId: params.sourceAdId ?? null,
          },
          tx,
        );
        await outboxWriter.write(
          `evt_rev_${created.id}`,
          "purchased",
          {
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
          },
          tx,
        );
        return created;
      });

      return {
        outcome: "completed" as const,
        summary: `Recorded ${params.type} of ${params.amount} ${params.currency} for contact ${params.contactId}`,
        outputs: { event },
      };
    },
  };
}
