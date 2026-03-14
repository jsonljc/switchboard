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

export {
  createPrismaStorage,
  PrismaLedgerStorage,
  PrismaConnectionStore,
  PrismaGovernanceProfileStore,
  PrismaCredentialResolver,
} from "./storage/index.js";
export type { ConnectionRecord } from "./storage/index.js";
export { PrismaCrmProvider } from "./storage/prisma-crm-provider.js";
export { PrismaCadenceStore } from "./storage/prisma-cadence-store.js";
export type { CadenceStore, CadenceInstanceRecord } from "./storage/prisma-cadence-store.js";
export { PrismaTierStore } from "./prisma-tier-store.js";
export { PrismaSmbActivityLogStorage } from "./prisma-smb-activity-log.js";
export { PrismaInterventionStore } from "./storage/prisma-intervention-store.js";
export { PrismaDiagnosticCycleStore } from "./storage/prisma-diagnostic-cycle-store.js";
export { PrismaRevenueAccountStore } from "./storage/prisma-revenue-account-store.js";
export { PrismaWeeklyDigestStore } from "./storage/prisma-weekly-digest-store.js";
export { encryptCredentials, decryptCredentials, isEncrypted } from "./crypto/credentials.js";
export { refreshMetaOAuthToken } from "./oauth/token-refresh.js";
export type { TokenRefreshResult } from "./oauth/token-refresh.js";
export { deriveAgentStates } from "./storage/agent-state-deriver.js";
export type { DerivedAgentState } from "./storage/agent-state-deriver.js";
export { PrismaAdsOperatorConfigStore } from "./ads-operator-config/store.js";
export { PrismaConnectorHealthLogStore } from "./storage/prisma-connector-health-log-store.js";
export { PrismaBusinessConfigStore } from "./storage/prisma-business-config-store.js";
export type { ConfigVersionRecord } from "./storage/prisma-business-config-store.js";
export { PrismaOutcomeStore } from "./storage/prisma-outcome-store.js";
