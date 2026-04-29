import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log:
        process.env.NODE_ENV === "production"
          ? [
              { emit: "event", level: "error" },
              { emit: "event", level: "warn" },
            ]
          : [
              { emit: "stdout", level: "query" },
              { emit: "stdout", level: "error" },
              { emit: "stdout", level: "warn" },
            ],
    });
    if (process.env.NODE_ENV === "production") {
      prisma.$on("error" as never, (e: unknown) => {
        console.error("[prisma] Error:", e);
      });
      prisma.$on("warn" as never, (e: unknown) => {
        console.warn("[prisma] Warning:", e);
      });
    }
  }
  return prisma;
}

export { PrismaClient };
export type { Prisma } from "@prisma/client";
export type { PrismaDbClient } from "./prisma-db.js";
export { isRootPrismaClient } from "./prisma-db.js";

export {
  createPrismaStorage,
  PrismaLedgerStorage,
  PrismaConnectionStore,
  PrismaGovernanceProfileStore,
  PrismaCredentialResolver,
} from "./storage/index.js";
export type { ConnectionRecord } from "./storage/index.js";
export { encryptCredentials, decryptCredentials, isEncrypted } from "./crypto/credentials.js";
export { refreshMetaOAuthToken } from "./oauth/token-refresh.js";
export type { TokenRefreshResult } from "./oauth/token-refresh.js";
export { deriveAgentStates } from "./storage/agent-state-deriver.js";
export type { DerivedAgentState } from "./storage/agent-state-deriver.js";
export { PrismaHandoffStore } from "./stores/handoff-store.js";
export { PrismaConversationStore } from "./stores/prisma-conversation-store.js";
export { PrismaKnowledgeStore } from "./stores/prisma-knowledge-store.js";
export {
  PrismaApprovalStore,
  PrismaSessionStore,
  PrismaRunStore,
  PrismaPauseStore,
  PrismaToolEventStore,
  PrismaRoleOverrideStore,
} from "./storage/index.js";
export { PrismaConversationThreadStore } from "./stores/prisma-thread-store.js";
export { PrismaWorkflowStore } from "./stores/prisma-workflow-store.js";
export { PrismaTriggerStore } from "./stores/prisma-trigger-store.js";
export { PrismaOperatorCommandStore } from "./stores/prisma-command-store.js";
export { PrismaContactStore } from "./stores/prisma-contact-store.js";
export { PrismaContactReader } from "./stores/prisma-contact-reader.js";
export type { ContactReader, ContactReaderRecord } from "./stores/prisma-contact-reader.js";
export { PrismaOpportunityStore } from "./stores/prisma-opportunity-store.js";
export { PrismaRevenueStore } from "./stores/prisma-revenue-store.js";
export { PrismaOwnerTaskStore } from "./stores/prisma-owner-task-store.js";
export { PrismaListingStore } from "./stores/prisma-listing-store.js";
export { PrismaDeploymentStore } from "./stores/prisma-deployment-store.js";
export { PrismaAgentTaskStore } from "./stores/prisma-agent-task-store.js";
export { PrismaTrustScoreStore } from "./stores/prisma-trust-score-store.js";
export { PrismaAgentPersonaStore } from "./stores/prisma-agent-persona-store.js";
export { PrismaActionRequestStore } from "./stores/prisma-action-request-store.js";
export { PrismaDeploymentStateStore } from "./stores/prisma-deployment-state-store.js";
export { PrismaDeploymentConnectionStore } from "./stores/prisma-deployment-connection-store.js";
export { PrismaCreativeJobStore } from "./stores/prisma-creative-job-store.js";
export { PrismaInteractionSummaryStore } from "./stores/prisma-interaction-summary-store.js";
export { PrismaDeploymentMemoryStore } from "./stores/prisma-deployment-memory-store.js";
export { PrismaEventStore } from "./stores/prisma-event-store.js";
export type { EmitEventInput } from "./stores/prisma-event-store.js";
export { PrismaActivityLogStore } from "./stores/prisma-activity-log-store.js";
export type { WriteActivityLogInput } from "./stores/prisma-activity-log-store.js";
export { PrismaCustomerMemoryStore } from "./stores/prisma-customer-memory-store.js";
export { PrismaOwnerMemoryStore } from "./stores/prisma-owner-memory-store.js";
export { PrismaAggregateMemoryStore } from "./stores/prisma-aggregate-memory-store.js";
export { PrismaCreatorIdentityStore } from "./stores/prisma-creator-identity-store.js";
export { PrismaAssetRecordStore } from "./stores/prisma-asset-record-store.js";
export { PrismaExecutionTraceStore } from "./stores/prisma-execution-trace-store.js";
export { PrismaKnowledgeEntryStore } from "./stores/prisma-knowledge-entry-store.js";
export { PrismaWorkTraceStore } from "./stores/prisma-work-trace-store.js";
export { PrismaBookingStore } from "./stores/prisma-booking-store.js";
export { PrismaOutboxStore } from "./stores/prisma-outbox-store.js";
export { PrismaConversionRecordStore } from "./stores/prisma-conversion-record-store.js";
export { PrismaDispatchLogStore } from "./stores/prisma-dispatch-log-store.js";
export { PrismaReconciliationStore } from "./stores/prisma-reconciliation-store.js";
export { PrismaLifecycleStore } from "./storage/prisma-lifecycle-store.js";
export { PrismaBusinessFactsStore } from "./stores/prisma-business-facts-store.js";
export { PrismaManagedChannelStore } from "./stores/prisma-managed-channel-store.js";
export { PrismaCrmDataProvider } from "./stores/prisma-crm-data-provider.js";
export { PrismaCrmFunnelStore } from "./stores/crm-funnel-store.js";
export type { CrmFunnelCountRow, FunnelStage } from "./stores/crm-funnel-store.js";
export { PrismaLeadIntakeStore } from "./stores/lead-intake-store.js";
export { PrismaProductIdentityStore } from "./stores/prisma-product-identity-store.js";
export type {
  CreateProductIdentityInput,
  AddProductImageInput,
} from "./stores/prisma-product-identity-store.js";
export { PrismaConsentRecordStore } from "./stores/prisma-consent-record-store.js";
export type { CreateConsentRecordInput } from "./stores/prisma-consent-record-store.js";
export { PrismaPcdIdentitySnapshotStore } from "./stores/prisma-pcd-identity-snapshot-store.js";
export type { CreatePcdIdentitySnapshotInput } from "./stores/prisma-pcd-identity-snapshot-store.js";
