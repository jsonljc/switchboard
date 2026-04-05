// ---------------------------------------------------------------------------
// Storage bootstrap — Prisma-backed or in-memory fallback
// ---------------------------------------------------------------------------

import {
  createInMemoryStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  DEFAULT_REDACTION_CONFIG,
  InMemoryPolicyCache,
  InMemoryGovernanceProfileStore,
} from "@switchboard/core";
import type {
  StorageContext,
  LedgerStorage,
  PolicyCache,
  GuardrailState,
  GovernanceProfileStore,
  GuardrailStateStore,
} from "@switchboard/core";
import { createGuardrailStateStore } from "../guardrail-state/index.js";
import type Redis from "ioredis";

export interface StorageBootstrapResult {
  storage: StorageContext;
  ledger: AuditLedger;
  guardrailState: GuardrailState;
  guardrailStateStore: GuardrailStateStore;
  policyCache: PolicyCache;
  governanceProfileStore: GovernanceProfileStore;
  prismaClient: import("@switchboard/db").PrismaClient | null;
  redis: Redis | null;
}

export async function bootstrapStorage(logger: {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}): Promise<StorageBootstrapResult> {
  let storage: StorageContext;
  let ledgerStorage: LedgerStorage;
  let prismaClient: import("@switchboard/db").PrismaClient | null = null;

  if (process.env["DATABASE_URL"]) {
    try {
      const { getDb, createPrismaStorage, PrismaLedgerStorage } = await import("@switchboard/db");
      prismaClient = getDb() as import("@switchboard/db").PrismaClient;
      await prismaClient.$queryRaw`SELECT 1`; // verify connectivity
      storage = createPrismaStorage(prismaClient as Parameters<typeof createPrismaStorage>[0]);
      ledgerStorage = new PrismaLedgerStorage(
        prismaClient as ConstructorParameters<typeof PrismaLedgerStorage>[0],
      );
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `DATABASE_URL is configured but the database is unreachable: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      logger.error(
        { err },
        "DATABASE_URL set but DB unreachable — falling back to in-memory (DEGRADED)",
      );
      storage = createInMemoryStorage();
      ledgerStorage = new InMemoryLedgerStorage();
      prismaClient = null;
    }
  } else {
    storage = createInMemoryStorage();
    ledgerStorage = new InMemoryLedgerStorage();
  }

  const ledger = new AuditLedger(ledgerStorage, DEFAULT_REDACTION_CONFIG);
  const guardrailState = createGuardrailState();

  // Shared Redis connection when REDIS_URL is available
  const redisUrl = process.env["REDIS_URL"];
  let redis: Redis | null = null;
  if (redisUrl) {
    const { default: IORedis } = await import("ioredis");
    redis = new IORedis(redisUrl);
  }

  const guardrailStateStore = createGuardrailStateStore(redis ?? undefined);
  const policyCache = new InMemoryPolicyCache();

  // Governance profile store: Prisma-backed when DB available, in-memory fallback
  let governanceProfileStore: GovernanceProfileStore;
  if (prismaClient) {
    const { PrismaGovernanceProfileStore } = await import("@switchboard/db");
    governanceProfileStore = new PrismaGovernanceProfileStore(prismaClient);
  } else {
    governanceProfileStore = new InMemoryGovernanceProfileStore();
  }

  return {
    storage,
    ledger,
    guardrailState,
    guardrailStateStore,
    policyCache,
    governanceProfileStore,
    prismaClient,
    redis,
  };
}
