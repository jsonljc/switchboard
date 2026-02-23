import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  DEFAULT_REDACTION_CONFIG,
  GuardedCartridge,
} from "@switchboard/core";
import type { StorageContext, LedgerStorage } from "@switchboard/core";
import { AdsSpendCartridge, DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";
import { createGuardrailStateStore } from "../guardrail-state/index.js";
import { createExecutionWorker } from "./worker.js";

async function main() {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    console.error("REDIS_URL is required to run the execution worker");
    process.exit(1);
  }

  // Create storage
  let storage: StorageContext;
  let ledgerStorage: LedgerStorage;

  if (process.env["DATABASE_URL"]) {
    const { getDb, createPrismaStorage, PrismaLedgerStorage } = await import("@switchboard/db");
    const prisma = getDb();
    storage = createPrismaStorage(prisma);
    ledgerStorage = new PrismaLedgerStorage(prisma);
  } else {
    storage = createInMemoryStorage();
    ledgerStorage = new InMemoryLedgerStorage();
  }

  const ledger = new AuditLedger(ledgerStorage, DEFAULT_REDACTION_CONFIG);
  const guardrailState = createGuardrailState();
  const guardrailStateStore = createGuardrailStateStore();

  // Register cartridges
  const adsCartridge = new AdsSpendCartridge();
  await adsCartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {
      accessToken: process.env["META_ADS_ACCESS_TOKEN"] ?? "mock-token",
      adAccountId: process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock",
    },
  });
  storage.cartridges.register("ads-spend", new GuardedCartridge(adsCartridge));
  await seedDefaultStorage(storage, DEFAULT_ADS_POLICIES);

  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    guardrailStateStore,
  });

  const worker = createExecutionWorker({
    connection: { url: redisUrl },
    orchestrator,
    storage,
    concurrency: parseInt(process.env["WORKER_CONCURRENCY"] ?? "5", 10),
  });

  console.log(`Switchboard execution worker started (concurrency=${worker.opts.concurrency})`);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, closing worker...`);
    await worker.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
