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
export { PrismaDeliveryStore } from "./stores/prisma-delivery-store.js";
export { PrismaKnowledgeStore } from "./stores/prisma-knowledge-store.js";
export {
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
export { PrismaOpportunityStore } from "./stores/prisma-opportunity-store.js";
export { PrismaRevenueStore } from "./stores/prisma-revenue-store.js";
export { PrismaOwnerTaskStore } from "./stores/prisma-owner-task-store.js";
export { PrismaListingStore } from "./stores/prisma-listing-store.js";
export { PrismaDeploymentStore } from "./stores/prisma-deployment-store.js";
export { PrismaAgentTaskStore } from "./stores/prisma-agent-task-store.js";
export { PrismaTrustScoreStore } from "./stores/prisma-trust-score-store.js";
export { PrismaAgentPersonaStore } from "./stores/prisma-agent-persona-store.js";
