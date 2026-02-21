import Fastify from "fastify";
import cors from "@fastify/cors";
import { actionsRoutes } from "./routes/actions.js";
import { approvalsRoutes } from "./routes/approvals.js";
import { policiesRoutes } from "./routes/policies.js";
import { auditRoutes } from "./routes/audit.js";
import { identityRoutes } from "./routes/identity.js";
import { simulateRoutes } from "./routes/simulate.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
} from "@switchboard/core";
import type { StorageContext } from "@switchboard/core";
import { AdsSpendCartridge, DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";

declare module "fastify" {
  interface FastifyInstance {
    orchestrator: LifecycleOrchestrator;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
  }
}

async function seedStorage(storage: StorageContext): Promise<void> {
  const now = new Date();
  await storage.identity.saveSpec({
    id: "spec_default",
    principalId: "default",
    organizationId: null,
    name: "Default User",
    description: "Default identity spec for API users",
    riskTolerance: {
      none: "none" as const,
      low: "none" as const,
      medium: "standard" as const,
      high: "elevated" as const,
      critical: "mandatory" as const,
    },
    globalSpendLimits: { daily: 10000, weekly: 50000, monthly: null, perAction: 5000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    createdAt: now,
    updatedAt: now,
  });

  for (const policy of DEFAULT_ADS_POLICIES) {
    await storage.policies.save(policy);
  }
}

export async function buildServer() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, { origin: true });

  // Create storage and orchestrator
  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage);
  const guardrailState = createGuardrailState();

  // Register ads-spend cartridge
  const adsCartridge = new AdsSpendCartridge();
  await adsCartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {
      accessToken: process.env["META_ADS_ACCESS_TOKEN"] ?? "mock-token",
      adAccountId: process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock",
    },
  });
  storage.cartridges.register("ads-spend", adsCartridge);

  // Seed default data
  await seedStorage(storage);

  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
  });

  // Decorate Fastify with shared instances
  app.decorate("orchestrator", orchestrator);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);

  // Register middleware
  await app.register(idempotencyMiddleware);

  // Health check
  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  // Register routes
  await app.register(actionsRoutes, { prefix: "/api/actions" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(policiesRoutes, { prefix: "/api/policies" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  await app.register(identityRoutes, { prefix: "/api/identity" });
  await app.register(simulateRoutes, { prefix: "/api/simulate" });

  return app;
}
