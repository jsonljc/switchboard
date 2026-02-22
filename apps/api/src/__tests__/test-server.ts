import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { actionsRoutes } from "../routes/actions.js";
import { approvalsRoutes } from "../routes/approvals.js";
import { policiesRoutes } from "../routes/policies.js";
import { auditRoutes } from "../routes/audit.js";
import { identityRoutes } from "../routes/identity.js";
import { simulateRoutes } from "../routes/simulate.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
} from "@switchboard/core";
import type { StorageContext } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import { DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";

// Re-declare Fastify augmentation for test context
declare module "fastify" {
  interface FastifyInstance {
    orchestrator: LifecycleOrchestrator;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
  }
}

export interface TestContext {
  app: FastifyInstance;
  cartridge: TestCartridge;
  storage: StorageContext;
}

export async function buildTestServer(): Promise<TestContext> {
  const app = Fastify({ logger: false });

  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage);
  const guardrailState = createGuardrailState();

  // Create and configure TestCartridge
  const cartridge = new TestCartridge(createTestManifest({ id: "ads-spend" }));

  // Default: high base risk → "medium" risk category (score ~56) → standard approval
  cartridge.onRiskInput(() => ({
    baseRisk: "high" as const,
    exposure: { dollarsAtRisk: 500, blastRadius: 1 },
    reversibility: "full" as const,
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  }));

  // Default: successful execution with undo recipe
  cartridge.onExecute((_actionType, params) => ({
    success: true,
    summary: `Executed ${_actionType}`,
    externalRefs: { campaignId: (params["campaignId"] as string) ?? "unknown" },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: 15,
    undoRecipe: {
      originalActionId: (params["_actionId"] as string) ?? "unknown",
      originalEnvelopeId: (params["_envelopeId"] as string) ?? "unknown",
      reverseActionType: "ads.campaign.resume",
      reverseParameters: { campaignId: params["campaignId"] },
      undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      undoRiskCategory: "medium",
      undoApprovalRequired: "none",
    },
  }));

  // Add resolveEntity to cartridge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cartridge as any).resolveEntity = async (
    inputRef: string,
    entityType: string,
  ) => ({
    id: `resolve_${Date.now()}`,
    inputRef,
    resolvedType: entityType,
    resolvedId: "camp_123",
    resolvedName: inputRef,
    confidence: 0.95,
    alternatives: [],
    status: "resolved" as const,
  });

  storage.cartridges.register("ads-spend", cartridge);

  // Seed default identity spec
  const now = new Date();
  await storage.identity.saveSpec({
    id: "spec_default",
    principalId: "default",
    organizationId: null,
    name: "Default User",
    description: "Default identity spec for testing",
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

  // Seed default policies
  for (const policy of DEFAULT_ADS_POLICIES) {
    await storage.policies.save(policy);
  }

  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
  });

  app.decorate("orchestrator", orchestrator);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);

  await app.register(idempotencyMiddleware);

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  await app.register(actionsRoutes, { prefix: "/api/actions" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(policiesRoutes, { prefix: "/api/policies" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  await app.register(identityRoutes, { prefix: "/api/identity" });
  await app.register(simulateRoutes, { prefix: "/api/simulate" });

  return { app, cartridge, storage };
}
