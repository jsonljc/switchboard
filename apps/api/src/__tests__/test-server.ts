import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";
import { actionsRoutes } from "../routes/actions.js";
import { executeRoutes } from "../routes/execute.js";
import { approvalsRoutes } from "../routes/approvals.js";
import { policiesRoutes } from "../routes/policies.js";
import { auditRoutes } from "../routes/audit.js";
import { identityRoutes } from "../routes/identity.js";
import { simulateRoutes } from "../routes/simulate.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  InMemoryPolicyCache,
  InMemoryGovernanceProfileStore,
  ExecutionService,
} from "@switchboard/core";
import type { StorageContext, PolicyCache } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import { DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";

// Re-declare Fastify augmentation for test context
declare module "fastify" {
  interface FastifyInstance {
    orchestrator: LifecycleOrchestrator;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
    policyCache: PolicyCache;
    executionService: ExecutionService;
  }
}

export interface TestContext {
  app: FastifyInstance;
  cartridge: TestCartridge;
  storage: StorageContext;
}

export async function buildTestServer(): Promise<TestContext> {
  const app = Fastify({ logger: false });

  // Global error handler (mirrors app.ts)
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage);
  const guardrailState = createGuardrailState();
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  // Create and configure TestCartridge
  const cartridge = new TestCartridge(createTestManifest({
    id: "ads-spend",
    actions: [
      { actionType: "ads.campaign.pause", name: "Pause Campaign", description: "Pause a campaign", parametersSchema: {}, baseRiskCategory: "medium" as const, reversible: true },
      { actionType: "ads.campaign.resume", name: "Resume Campaign", description: "Resume a campaign", parametersSchema: {}, baseRiskCategory: "medium" as const, reversible: true },
      { actionType: "ads.budget.adjust", name: "Adjust Budget", description: "Adjust budget", parametersSchema: {}, baseRiskCategory: "high" as const, reversible: true },
    ],
  }));

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

  // Seed a default allow policy (policy engine now defaults to deny when no policy matches)
  await storage.policies.save({
    id: "default-allow-ads",
    name: "Default allow ads-spend",
    description: "Allow all ads-spend actions",
    organizationId: null,
    cartridgeId: "ads-spend",
    priority: 100,
    active: true,
    rule: { composition: "AND", conditions: [], children: [] },
    effect: "allow",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Seed default identity spec and policies
  await seedDefaultStorage(storage, DEFAULT_ADS_POLICIES);

  // Save principal records for test actors
  await storage.identity.savePrincipal({
    id: "default",
    type: "user",
    name: "Default User",
    organizationId: null,
    roles: ["requester"],
  });
  await storage.identity.savePrincipal({
    id: "reviewer_1",
    type: "user",
    name: "Reviewer 1",
    organizationId: null,
    roles: ["approver"],
  });

  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    policyCache,
    governanceProfileStore,
    routingConfig: {
      defaultApprovers: ["reviewer_1"],
      defaultFallbackApprover: null,
      defaultExpiryMs: 24 * 60 * 60 * 1000,
      defaultExpiredBehavior: "deny" as const,
      elevatedExpiryMs: 12 * 60 * 60 * 1000,
      mandatoryExpiryMs: 4 * 60 * 60 * 1000,
      denyWhenNoApprovers: true,
    },
  });

  const executionService = new ExecutionService(orchestrator, storage);
  app.decorate("orchestrator", orchestrator);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);
  app.decorate("policyCache", policyCache);
  app.decorate("executionService", executionService);

  await app.register(idempotencyMiddleware);

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  await app.register(actionsRoutes, { prefix: "/api/actions" });
  await app.register(executeRoutes, { prefix: "/api" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(policiesRoutes, { prefix: "/api/policies" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  await app.register(identityRoutes, { prefix: "/api/identity" });
  await app.register(simulateRoutes, { prefix: "/api/simulate" });

  return { app, cartridge, storage };
}
