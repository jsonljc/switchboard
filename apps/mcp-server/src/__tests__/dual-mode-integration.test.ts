import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
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
  CartridgeReadAdapter,
  inferCartridgeId,
} from "@switchboard/core";
import type { StorageContext, GovernanceProfileStore, PolicyCache } from "@switchboard/core";
import { profileToPosture } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import {
  handleSideEffectTool,
  handleReadTool,
  handleGovernanceTool,
} from "../tools/index.js";
import type { ReadToolDeps, GovernanceToolDeps } from "../tools/index.js";
import type { McpAuthContext } from "../auth.js";
import { McpApiClient } from "../api-client.js";
import { ApiReadAdapter } from "../adapters/api-read-adapter.js";
import {
  createApiOrchestrator,
  createApiStorage,
  createApiGovernanceProfileStore,
  createApiLedger,
} from "../adapters/api-governance-adapter.js";

// ── Shared cartridge setup ──────────────────────────────────────────

function createTestCartridgeFixture() {
  const cartridge = new TestCartridge(
    createTestManifest({
      id: "digital-ads",
      actions: [
        { actionType: "digital-ads.campaign.pause", name: "Pause Campaign", description: "Pause", parametersSchema: {}, baseRiskCategory: "medium" as const, reversible: true },
        { actionType: "digital-ads.campaign.resume", name: "Resume Campaign", description: "Resume", parametersSchema: {}, baseRiskCategory: "medium" as const, reversible: true },
        { actionType: "digital-ads.budget.adjust", name: "Adjust Budget", description: "Budget", parametersSchema: {}, baseRiskCategory: "high" as const, reversible: true },
      ],
    }),
  );

  cartridge.onRiskInput(() => ({
    baseRisk: "high" as const,
    exposure: { dollarsAtRisk: 500, blastRadius: 1 },
    reversibility: "full" as const,
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  }));

  cartridge.onExecute((_actionType, params) => ({
    success: true,
    summary: `Executed ${_actionType}`,
    externalRefs: { campaignId: (params["campaignId"] as string) ?? "unknown" },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: 15,
    undoRecipe: null,
  }));

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

  return cartridge;
}

async function seedTestStorage(storage: StorageContext) {
  await storage.policies.save({
    id: "default-allow-ads",
    name: "Default allow digital-ads",
    description: "Allow all digital-ads actions",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 100,
    active: true,
    rule: { composition: "AND", conditions: [], children: [] },
    effect: "allow",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await seedDefaultStorage(storage);

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
}

function buildOrchestrator(
  storage: StorageContext,
  ledger: AuditLedger,
  policyCache: PolicyCache,
  governanceProfileStore: GovernanceProfileStore,
) {
  return new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState: createGuardrailState(),
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
}

// ── Context type ────────────────────────────────────────────────────

interface ModeContext {
  executionService: ExecutionService;
  readDeps: ReadToolDeps;
  governanceDeps: GovernanceToolDeps;
  auth: McpAuthContext;
}

// ── In-memory mode context ──────────────────────────────────────────

async function buildInMemoryContext(): Promise<ModeContext> {
  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage);
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  const cartridge = createTestCartridgeFixture();
  storage.cartridges.register("digital-ads", cartridge);
  await seedTestStorage(storage);

  const orchestrator = buildOrchestrator(storage, ledger, policyCache, governanceProfileStore);
  const executionService = new ExecutionService(orchestrator, storage);
  const readAdapter = new CartridgeReadAdapter(storage, ledger);
  const auth: McpAuthContext = { actorId: "default", organizationId: null };

  return {
    executionService,
    readDeps: { readAdapter, orchestrator: orchestrator as any, storage: storage as any },
    governanceDeps: {
      orchestrator: orchestrator as any,
      readAdapter,
      governanceProfileStore,
      ledger: ledger as any,
      storage: storage as any,
    },
    auth,
  };
}

// ── API mode: build a minimal Fastify server with the endpoints that
//    the MCP API adapters call, then wire up the MCP tools to use them.

async function buildApiModeServer(): Promise<{
  app: FastifyInstance;
  port: number;
  storage: StorageContext;
  orchestrator: LifecycleOrchestrator;
  ledger: AuditLedger;
  governanceProfileStore: GovernanceProfileStore;
}> {
  const app = Fastify({ logger: false });

  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage);
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  const cartridge = createTestCartridgeFixture();
  storage.cartridges.register("digital-ads", cartridge);
  await seedTestStorage(storage);

  const orchestrator = buildOrchestrator(storage, ledger, policyCache, governanceProfileStore);
  const executionService = new ExecutionService(orchestrator, storage);

  // --- Minimal API routes matching what the MCP API adapters call ---

  // Health
  app.get("/health", async () => ({ status: "ok" }));

  // POST /api/simulate
  app.post("/api/simulate", async (req, reply) => {
    const body = req.body as any;
    const cartridgeId = body.cartridgeId ?? inferCartridgeId(body.actionType);
    const result = await orchestrator.simulate({
      actionType: body.actionType,
      parameters: body.parameters,
      principalId: body.actorId ?? "default",
      cartridgeId,
    });
    return reply.code(200).send(result);
  });

  // POST /api/execute
  app.post("/api/execute", async (req, reply) => {
    const body = req.body as any;
    try {
      const result = await executionService.execute({
        actorId: body.actorId ?? "default",
        organizationId: body.organizationId ?? null,
        requestedAction: body.action,
        message: body.message,
      });
      return reply.code(200).send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message ?? String(err) });
    }
  });

  // GET /api/actions/:id
  app.get("/api/actions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const envelope = await storage.envelopes.getById(id);
    if (!envelope) return reply.code(404).send({ error: "Not found" });
    return reply.code(200).send(envelope);
  });

  // POST /api/actions/:id/execute
  app.post("/api/actions/:id/execute", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await orchestrator.executeApproved(id);
    return reply.code(200).send({ result });
  });

  // POST /api/actions/:id/undo
  app.post("/api/actions/:id/undo", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await orchestrator.requestUndo(id);
    return reply.code(200).send(result);
  });

  // GET /api/approvals/pending
  app.get("/api/approvals/pending", async (req, reply) => {
    const orgId = (req.query as any).organizationId;
    const approvals = await storage.approvals.listPending(orgId);
    return reply.code(200).send({
      approvals: approvals.map((a: any) => ({
        id: a.request.id,
        summary: a.request.summary,
        riskCategory: a.request.riskCategory,
        expiresAt: a.request.expiresAt,
        status: a.state.status,
        envelopeId: a.envelopeId,
      })),
    });
  });

  // GET /api/approvals/:id
  app.get("/api/approvals/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const approval = await storage.approvals.getById(id);
    if (!approval) return reply.code(404).send({ error: "Not found" });
    return reply.code(200).send({
      id: approval.request.id,
      summary: approval.request.summary,
      riskCategory: approval.request.riskCategory,
      expiresAt: approval.request.expiresAt,
      status: approval.state.status,
      envelopeId: approval.envelopeId,
      organizationId: approval.organizationId ?? null,
    });
  });

  // GET /api/audit
  app.get("/api/audit", async (req, reply) => {
    const q = req.query as any;
    const filter: any = {};
    if (q.envelopeId) filter.envelopeId = q.envelopeId;
    if (q.entityId) filter.entityId = q.entityId;
    if (q.eventType) filter.eventType = q.eventType;
    if (q.limit) filter.limit = Number(q.limit);
    if (q.after) filter.after = new Date(q.after);
    if (q.before) filter.before = new Date(q.before);

    const entries = await ledger.query(filter);
    return reply.code(200).send({
      entries: entries.map((e: any) => ({
        id: e.id,
        eventType: e.eventType,
        timestamp: e.timestamp,
        actorId: e.actorId,
        entityType: e.entityType,
        entityId: e.entityId,
        riskCategory: e.riskCategory,
        summary: e.summary,
        envelopeId: e.envelopeId,
      })),
    });
  });

  // GET /api/governance/:orgId/status
  app.get("/api/governance/:orgId/status", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const profile = await governanceProfileStore.get(orgId);
    const posture = profileToPosture(profile);
    const config = await governanceProfileStore.getConfig(orgId);
    return reply.code(200).send({ organizationId: orgId, profile, posture, config });
  });

  // PUT /api/governance/:orgId/profile
  app.put("/api/governance/:orgId/profile", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as any;
    await governanceProfileStore.set(orgId, body.profile);
    return reply.code(200).send({ ok: true });
  });

  // GET /api/cartridges
  app.get("/api/cartridges", async (_req, reply) => {
    const ids = storage.cartridges.list();
    const manifests = ids
      .map((id) => storage.cartridges.get(id)?.manifest ?? null)
      .filter(Boolean);
    return reply.code(200).send({ cartridges: manifests });
  });

  const _address = await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;

  return { app, port, storage, orchestrator, ledger, governanceProfileStore };
}

async function buildApiContext(): Promise<{ ctx: ModeContext; app: FastifyInstance }> {
  const { app, port, storage: serverStorage } = await buildApiModeServer();

  const client = new McpApiClient({ baseUrl: `http://127.0.0.1:${port}` });

  const apiOrchestrator = createApiOrchestrator(client);
  const apiLedger = createApiLedger(client);
  const apiGovernanceProfileStore = createApiGovernanceProfileStore(client);
  const readAdapter = new ApiReadAdapter(client);

  // Build a storage proxy that has a working cartridges registry
  // so inferCartridgeId can resolve action types → cartridge IDs.
  const apiStorage = createApiStorage(client);
  const storageWithCartridges = {
    ...apiStorage,
    cartridges: {
      get(id: string) {
        // Delegate to the real server's registry for manifest lookups
        return serverStorage.cartridges.get(id);
      },
      list() {
        return serverStorage.cartridges.list();
      },
    },
  };

  // API-backed execution service proxy (matches RuntimeAdapter interface)
  const apiExecutionService = {
    async execute(request: {
      actorId: string;
      organizationId?: string | null;
      requestedAction: { actionType: string; parameters: Record<string, unknown>; sideEffect?: boolean };
      message?: string;
    }) {
      const { data } = await client.post<{
        outcome: string;
        envelopeId: string;
        traceId?: string;
        executionResult?: unknown;
        approvalId?: string;
        approvalRequest?: unknown;
        deniedExplanation?: string;
      }>("/api/execute", {
        actorId: request.actorId,
        organizationId: request.organizationId ?? null,
        action: {
          actionType: request.requestedAction.actionType,
          parameters: request.requestedAction.parameters,
          sideEffect: request.requestedAction.sideEffect ?? true,
        },
        message: request.message,
      }, client.idempotencyKey("mcp_exec"));

      return {
        outcome: data.outcome,
        envelopeId: data.envelopeId,
        traceId: data.traceId ?? data.envelopeId,
        executionResult: data.executionResult,
        approvalId: data.approvalId,
        approvalRequest: data.approvalRequest,
        deniedExplanation: data.deniedExplanation,
      };
    },
  } as unknown as ExecutionService;

  const auth: McpAuthContext = { actorId: "default", organizationId: null };

  return {
    ctx: {
      executionService: apiExecutionService,
      readDeps: {
        readAdapter: readAdapter as any,
        orchestrator: apiOrchestrator as any,
        storage: storageWithCartridges as any,
      },
      governanceDeps: {
        orchestrator: apiOrchestrator as any,
        readAdapter: readAdapter as any,
        governanceProfileStore: apiGovernanceProfileStore as any,
        ledger: apiLedger as any,
        storage: storageWithCartridges as any,
      },
      auth,
    },
    app,
  };
}

// ── Structural comparison helpers ───────────────────────────────────

function hasKeys(obj: unknown, keys: string[]): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  return keys.every((k) => k in obj);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Dual-mode integration: in-memory vs API", () => {
  let inMemory: ModeContext;
  let api: ModeContext;
  let apiApp: FastifyInstance;

  beforeAll(async () => {
    inMemory = await buildInMemoryContext();
    const apiResult = await buildApiContext();
    api = apiResult.ctx;
    apiApp = apiResult.app;
  }, 30_000);

  afterAll(async () => {
    await apiApp.close();
  });

  it("simulate_action returns structurally equivalent results", async () => {
    const args = {
      actionType: "digital-ads.campaign.pause",
      parameters: { campaignId: "camp_sim_test" },
    };

    const inMemoryResult = await handleReadTool("simulate_action", args, inMemory.auth, inMemory.readDeps) as Record<string, unknown>;
    const apiResult = await handleReadTool("simulate_action", args, api.auth, api.readDeps) as Record<string, unknown>;

    // Both should have decision, risk score, and risk category
    expect(hasKeys(inMemoryResult, ["decision", "riskScore", "riskCategory"])).toBe(true);
    expect(hasKeys(apiResult, ["decision", "riskScore", "riskCategory"])).toBe(true);

    // Decision types should match
    expect(inMemoryResult.decision).toBe(apiResult.decision);
    expect(inMemoryResult.riskCategory).toBe(apiResult.riskCategory);
  });

  it("list_pending_approvals returns structurally equivalent results", async () => {
    const inMemoryResult = await handleReadTool("list_pending_approvals", {}, inMemory.auth, inMemory.readDeps) as { approvals: unknown[] };
    const apiResult = await handleReadTool("list_pending_approvals", {}, api.auth, api.readDeps) as { approvals: unknown[] };

    // Both should return an approvals array
    expect(Array.isArray(inMemoryResult.approvals)).toBe(true);
    expect(Array.isArray(apiResult.approvals)).toBe(true);
  });

  it("get_governance_status returns structurally equivalent results", async () => {
    const inMemoryResult = await handleGovernanceTool("get_governance_status", {}, inMemory.auth, inMemory.governanceDeps) as Record<string, unknown>;
    const apiResult = await handleGovernanceTool("get_governance_status", {}, api.auth, api.governanceDeps) as Record<string, unknown>;

    // Both should have profile and posture
    expect(hasKeys(inMemoryResult, ["profile", "posture"])).toBe(true);
    expect(hasKeys(apiResult, ["profile", "posture"])).toBe(true);

    // Default profile should be the same
    expect(inMemoryResult.profile).toBe(apiResult.profile);
  });

  it("propose (pause_campaign) returns structurally equivalent results", async () => {
    const args = { campaignId: "camp_dual_test" };

    const inMemoryResult = await handleSideEffectTool("pause_campaign", args, inMemory.auth, inMemory.executionService) as unknown as Record<string, unknown>;
    const apiResult = await handleSideEffectTool("pause_campaign", args, api.auth, api.executionService) as unknown as Record<string, unknown>;

    // Both should have outcome and envelopeId
    expect(hasKeys(inMemoryResult, ["outcome", "envelopeId"])).toBe(true);
    expect(hasKeys(apiResult, ["outcome", "envelopeId"])).toBe(true);

    // Outcomes should match (both use same cartridge config)
    expect(inMemoryResult.outcome).toBe(apiResult.outcome);

    // IDs will differ, but both should be non-empty strings
    expect(typeof inMemoryResult.envelopeId).toBe("string");
    expect(typeof apiResult.envelopeId).toBe("string");
    expect((inMemoryResult.envelopeId as string).length).toBeGreaterThan(0);
    expect((apiResult.envelopeId as string).length).toBeGreaterThan(0);
  });

  it("list_pending_approvals shows proposal after propose", async () => {
    // Both modes should now have at least one pending approval from the propose test above
    const inMemoryResult = await handleReadTool("list_pending_approvals", {}, inMemory.auth, inMemory.readDeps) as { approvals: unknown[] };
    const apiResult = await handleReadTool("list_pending_approvals", {}, api.auth, api.readDeps) as { approvals: unknown[] };

    // If the proposal required approval, both should list it
    if (inMemoryResult.approvals.length > 0) {
      expect(apiResult.approvals.length).toBeGreaterThan(0);
    }
  });
}, 60_000);
