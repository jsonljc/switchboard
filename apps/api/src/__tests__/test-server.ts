import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";
import { actionsRoutes } from "../routes/actions.js";
import { executeRoutes } from "../routes/execute.js";
import { approvalsRoutes } from "../routes/approvals.js";
import { policiesRoutes } from "../routes/policies.js";
import { auditRoutes } from "../routes/audit.js";
import { identityRoutes } from "../routes/identity.js";
import { recommendationsRoutes } from "../routes/recommendations.js";
import { dashboardAgentsRoutes } from "../routes/dashboard-agents.js";
import { decisionsRoutes } from "../routes/decisions.js";
import { winsRoute } from "../routes/agent-home/wins.js";
import { pipelineRoute } from "../routes/agent-home/pipeline.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import {
  createInMemoryStorage,
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  InMemoryPolicyCache,
  InMemoryGovernanceProfileStore,
  evaluate,
  resolveIdentity,
  createInMemoryRecommendationStore,
} from "@switchboard/core";
import { createInMemoryOrgAgentEnablementStore } from "@switchboard/db";
import type {
  StorageContext,
  PolicyCache,
  ContactStore,
  HandoffStore,
  HandoffPackage,
  HandoffStatus,
  ConversationThreadStore,
} from "@switchboard/core";
import type { Contact, ConversationThread } from "@switchboard/schemas";
import type { ApprovalRoutingConfig } from "@switchboard/core/approval";
import {
  IntentRegistry,
  ExecutionModeRegistry,
  GovernanceGate,
  CartridgeMode,
  PlatformIngress,
  PlatformLifecycle,
  registerCartridgeIntents,
} from "@switchboard/core/platform";
import type {
  GovernanceCartridge,
  CartridgeManifestForRegistration,
  WorkTrace,
  WorkTraceStore,
  WorkTraceUpdateResult,
  WorkTraceReadResult,
} from "@switchboard/core/platform";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";

class InMemoryWorkTraceStore implements WorkTraceStore {
  private traces = new Map<string, WorkTrace>();

  async persist(trace: WorkTrace): Promise<void> {
    this.traces.set(trace.workUnitId, { ...trace });
  }

  async getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadResult | null> {
    const trace = this.traces.get(workUnitId);
    if (!trace) return null;
    return { trace, integrity: { status: "ok" as const } };
  }

  async update(workUnitId: string, fields: Partial<WorkTrace>): Promise<WorkTraceUpdateResult> {
    const existing = this.traces.get(workUnitId);
    if (existing) {
      this.traces.set(workUnitId, { ...existing, ...fields });
    }
    return { ok: true, trace: this.traces.get(workUnitId) ?? ({} as never) };
  }

  async getByIdempotencyKey(key: string): Promise<WorkTraceReadResult | null> {
    for (const trace of this.traces.values()) {
      if (trace.idempotencyKey === key) return { trace, integrity: { status: "ok" as const } };
    }
    return null;
  }
}

// Re-declare Fastify augmentation for test context
declare module "fastify" {
  interface FastifyInstance {
    authDisabled: boolean;
    approvalRoutingConfig: ApprovalRoutingConfig;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
    policyCache: PolicyCache;
    platformIngress: PlatformIngress;
    platformLifecycle: PlatformLifecycle;
    recommendationStore?: import("@switchboard/core").RecommendationStore;
    orgAgentEnablementStore?: import("@switchboard/core").OrgAgentEnablementStore;
    contactStore?: ContactStore;
    handoffStore?: HandoffStore;
    threadStore?: ConversationThreadStore;
    reportCacheStore?: import("@switchboard/core/reports").ReportCacheStore;
    reportStores?: import("@switchboard/core/reports").ReportStores;
    reportInsightsProvider?: import("@switchboard/schemas").ReportInsightsProvider | null;
  }
}

// ---------------------------------------------------------------------------
// Minimal in-memory stubs for the decision feed.
// Tests that need to seed contacts/threads/handoffs can do so via
// `app.contactStore.create(...)` etc. — only the methods used by routes/tests
// are implemented here.
// ---------------------------------------------------------------------------

class TestContactStore implements ContactStore {
  private rows = new Map<string, Contact>();

  async create(input: import("@switchboard/core").CreateContactInput): Promise<Contact> {
    const id = `contact-${this.rows.size + 1}`;
    const now = new Date();
    const messagingOptIn = input.messagingOptIn ?? false;
    const contact: Contact = {
      id,
      organizationId: input.organizationId,
      name: input.name ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      primaryChannel: input.primaryChannel,
      firstTouchChannel: input.firstTouchChannel ?? null,
      stage: "new",
      source: input.source ?? null,
      attribution: (input.attribution as Contact["attribution"]) ?? null,
      roles: input.roles ?? ["lead"],
      messagingOptIn,
      messagingOptInAt: messagingOptIn ? now : null,
      messagingOptInSource: input.messagingOptInSource ?? null,
      messagingOptOutAt: null,
      firstContactAt: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, contact);
    return contact;
  }

  async recordMessagingOptOut(_orgId: string, id: string): Promise<void> {
    const c = this.rows.get(id);
    if (!c) throw new Error(`Contact not found: ${id}`);
    const now = new Date();
    this.rows.set(id, {
      ...c,
      messagingOptIn: false,
      messagingOptOutAt: now,
      updatedAt: now,
    });
  }

  async delete(_orgId: string, id: string): Promise<void> {
    if (!this.rows.has(id)) throw new Error(`Contact not found: ${id}`);
    this.rows.delete(id);
  }

  async findById(_orgId: string, id: string): Promise<Contact | null> {
    return this.rows.get(id) ?? null;
  }

  async findByPhone(_orgId: string, phone: string): Promise<Contact | null> {
    for (const c of this.rows.values()) if (c.phone === phone) return c;
    return null;
  }

  async updateStage(
    _orgId: string,
    id: string,
    stage: import("@switchboard/schemas").ContactStage,
  ): Promise<Contact> {
    const c = this.rows.get(id);
    if (!c) throw new Error(`Contact not found: ${id}`);
    const updated = { ...c, stage, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async updateLastActivity(_orgId: string, id: string): Promise<void> {
    const c = this.rows.get(id);
    if (!c) return;
    this.rows.set(id, { ...c, lastActivityAt: new Date(), updatedAt: new Date() });
  }

  async list(orgId: string): Promise<Contact[]> {
    return Array.from(this.rows.values()).filter((c) => c.organizationId === orgId);
  }

  async listByIds(orgId: string, ids: string[]): Promise<Map<string, Contact>> {
    const out = new Map<string, Contact>();
    for (const id of ids) {
      const c = this.rows.get(id);
      if (c && c.organizationId === orgId) out.set(id, c);
    }
    return out;
  }

  async listForPipeline(args: {
    orgId: string;
    activitySince: Date;
    limit: number;
  }): Promise<{ rows: Contact[]; totalCount: number }> {
    const filtered = Array.from(this.rows.values())
      .filter(
        (c) =>
          c.organizationId === args.orgId &&
          (c.stage === "active" || c.stage === "new") &&
          c.lastActivityAt.getTime() >= args.activitySince.getTime(),
      )
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    return { rows: filtered.slice(0, args.limit), totalCount: filtered.length };
  }
}

class TestHandoffStore implements HandoffStore {
  private rows = new Map<string, HandoffPackage>();

  async save(pkg: HandoffPackage): Promise<void> {
    this.rows.set(pkg.id, pkg);
  }

  async getById(id: string): Promise<HandoffPackage | null> {
    return this.rows.get(id) ?? null;
  }

  async getBySessionId(sessionId: string): Promise<HandoffPackage | null> {
    for (const r of this.rows.values()) if (r.sessionId === sessionId) return r;
    return null;
  }

  async updateStatus(id: string, status: HandoffStatus, acknowledgedAt?: Date): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    this.rows.set(id, { ...r, status, ...(acknowledgedAt ? { acknowledgedAt } : {}) });
  }

  async listPending(organizationId: string): Promise<HandoffPackage[]> {
    return Array.from(this.rows.values()).filter(
      (r) =>
        r.organizationId === organizationId &&
        (r.status === "pending" || r.status === "assigned" || r.status === "active"),
    );
  }
}

class TestThreadStore implements ConversationThreadStore {
  private rows = new Map<string, ConversationThread>();
  private keyOf = (orgId: string, contactId: string) => `${orgId}::${contactId}`;

  async getByContact(
    contactId: string,
    organizationId: string,
  ): Promise<ConversationThread | null> {
    return this.rows.get(this.keyOf(organizationId, contactId)) ?? null;
  }

  async create(thread: ConversationThread): Promise<void> {
    this.rows.set(this.keyOf(thread.organizationId, thread.contactId), thread);
  }

  async update(): Promise<void> {
    // No-op for the routes that exercise this store today; tests that need it
    // can seed directly via create().
  }

  async listByContactIds(
    orgId: string,
    contactIds: string[],
  ): Promise<Map<string, ConversationThread>> {
    const out = new Map<string, ConversationThread>();
    for (const id of contactIds) {
      const t = this.rows.get(this.keyOf(orgId, id));
      if (t) out.set(id, t);
    }
    return out;
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
  // guardrailState removed — was only used by LifecycleOrchestrator
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  // Create and configure TestCartridge
  const cartridge = new TestCartridge(
    createTestManifest({
      id: "digital-ads",
      actions: [
        {
          actionType: "digital-ads.campaign.pause",
          name: "Pause Campaign",
          description: "Pause a campaign",
          parametersSchema: {},
          baseRiskCategory: "medium" as const,
          reversible: true,
        },
        {
          actionType: "digital-ads.campaign.resume",
          name: "Resume Campaign",
          description: "Resume a campaign",
          parametersSchema: {},
          baseRiskCategory: "medium" as const,
          reversible: true,
        },
        {
          actionType: "digital-ads.budget.adjust",
          name: "Adjust Budget",
          description: "Adjust budget",
          parametersSchema: {},
          baseRiskCategory: "high" as const,
          reversible: true,
        },
      ],
    }),
  );

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
      reverseActionType: "digital-ads.campaign.resume",
      reverseParameters: { campaignId: params["campaignId"] },
      undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      undoRiskCategory: "medium",
      undoApprovalRequired: "none",
    },
  }));

  // Add resolveEntity to cartridge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cartridge as any).resolveEntity = async (inputRef: string, entityType: string) => ({
    id: `resolve_${Date.now()}`,
    inputRef,
    resolvedType: entityType,
    resolvedId: "camp_123",
    resolvedName: inputRef,
    confidence: 0.95,
    alternatives: [],
    status: "resolved" as const,
  });

  storage.cartridges.register("digital-ads", cartridge);

  // Seed a default allow policy (policy engine now defaults to deny when no policy matches)
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

  // Seed default identity spec (no production policies — test has its own allow policy above)
  await seedDefaultStorage(storage);

  // Override risk tolerance to not require approval for tests
  const spec = await storage.identity.getSpecByPrincipalId("default");
  if (spec) {
    spec.riskTolerance = {
      none: "none" as const,
      low: "none" as const,
      medium: "none" as const, // Changed from "standard" to avoid approval requirement in tests
      high: "none" as const,
      critical: "none" as const,
    };
    await storage.identity.saveSpec(spec);
  }

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

  const approvalRoutingConfig: ApprovalRoutingConfig = {
    defaultApprovers: ["reviewer_1"],
    defaultFallbackApprover: null,
    defaultExpiryMs: 24 * 60 * 60 * 1000,
    defaultExpiredBehavior: "deny" as const,
    elevatedExpiryMs: 12 * 60 * 60 * 1000,
    mandatoryExpiryMs: 4 * 60 * 60 * 1000,
    denyWhenNoApprovers: true,
  };

  // Test harness runs without auth middleware; mark dev mode so org-derivation helpers
  // accept body.organizationId (matches the documented dev-mode behavior).
  app.decorate("authDisabled", true);
  app.decorate("approvalRoutingConfig", approvalRoutingConfig);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);
  app.decorate("policyCache", policyCache);

  // In-memory recommendation store — tests interact with this via app.recommendationStore.
  const recommendationStore = createInMemoryRecommendationStore();
  app.decorate("recommendationStore", recommendationStore);

  // In-memory org-agent-enablement store — tests interact via app.orgAgentEnablementStore.
  const orgAgentEnablementStore = createInMemoryOrgAgentEnablementStore();
  app.decorate("orgAgentEnablementStore", orgAgentEnablementStore);

  // In-memory stores for the decision feed — tests can seed via app.handoffStore.save() etc.
  app.decorate("contactStore", new TestContactStore());
  app.decorate("handoffStore", new TestHandoffStore());
  app.decorate("threadStore", new TestThreadStore());

  const { createInMemoryReportCacheStore } = await import("@switchboard/core/reports");

  app.decorate("reportCacheStore", createInMemoryReportCacheStore());
  app.decorate("reportStores", {
    revenue: {
      sumByOrg: async () => ({ totalAmount: 5000, count: 3 }),
      revenueWithFirstTouch: async () => [
        {
          amount: 5000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "c-1",
          firstTouchSourceChannel: null,
        },
      ],
      revenueByCampaign: async () => [],
    },
    bookings: { countExcludingStatuses: async () => 10 },
    opportunities: { countClosedWon: async () => 3 },
    conversions: {
      countByType: async () => 50,
      leadsBySource: async () => [
        { sourceAdId: "ad-1", sourceCampaignId: "c-1", sourceChannel: null },
      ],
    },
    recommendations: { latestByAgent: async () => null },
    conversations: { threadCountsByAgent: async () => [] },
    deployment: { getAlexSlug: async () => null },
    orgConfig: { getStripePriceId: async () => null },
  });

  // --- PlatformIngress wiring ---
  const intentRegistry = new IntentRegistry();
  const cartridgeManifests: CartridgeManifestForRegistration[] = [];
  for (const cartridgeId of storage.cartridges.list()) {
    const c = storage.cartridges.get(cartridgeId);
    if (!c) continue;
    const manifest = c.manifest;
    if (!manifest.actions || manifest.actions.length === 0) continue;
    cartridgeManifests.push({
      id: manifest.id,
      actions: manifest.actions.map((a) => ({
        name: a.actionType.startsWith(`${manifest.id}.`)
          ? a.actionType.slice(manifest.id.length + 1)
          : a.actionType,
        description: a.description,
        riskCategory: a.baseRiskCategory,
      })),
    });
  }
  registerCartridgeIntents(intentRegistry, cartridgeManifests);

  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(new CartridgeMode({ cartridgeRegistry: storage.cartridges }));

  const platformGovernanceGate = new GovernanceGate({
    evaluate,
    resolveIdentity,
    loadPolicies: async (orgId) => storage.policies.listActive({ organizationId: orgId }),
    loadIdentitySpec: async (actorId) => {
      const spec = await storage.identity.getSpecByPrincipalId(actorId);
      if (!spec) throw new Error(`Identity spec not found: ${actorId}`);
      const overlays = await storage.identity.listOverlaysBySpecId(spec.id);
      return { spec, overlays };
    },
    loadCartridge: async (cId) => storage.cartridges.get(cId) as GovernanceCartridge | null,
    getGovernanceProfile: async (_orgId) => governanceProfileStore.get(_orgId),
  });

  const workTraceStore = new InMemoryWorkTraceStore();

  const { resolveAuthoritativeDeployment } =
    await import("../bootstrap/platform-deployment-resolver.js");

  const platformIngress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: platformGovernanceGate,
    deploymentResolver: resolveAuthoritativeDeployment(null),
    traceStore: workTraceStore,
    entitlementResolver: undefined,
  });
  app.decorate("platformIngress", platformIngress);

  const platformLifecycle = new PlatformLifecycle({
    approvalStore: storage.approvals,
    envelopeStore: storage.envelopes,
    identityStore: storage.identity,
    modeRegistry,
    traceStore: workTraceStore,
    ledger,
    trustAdapter: null,
    selfApprovalAllowed: false,
    approvalRateLimit: null,
  });
  app.decorate("platformLifecycle", platformLifecycle);

  await app.register(idempotencyMiddleware);

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  await app.register(actionsRoutes, { prefix: "/api/actions" });
  await app.register(executeRoutes, { prefix: "/api" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(policiesRoutes, { prefix: "/api/policies" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  await app.register(identityRoutes, { prefix: "/api/identity" });
  await app.register(recommendationsRoutes, { prefix: "/api/recommendations" });
  await app.register(dashboardAgentsRoutes, { prefix: "/api/dashboard/agents" });
  await app.register(decisionsRoutes, { prefix: "/api/dashboard" });
  await app.register(winsRoute, { prefix: "/api/dashboard" });
  await app.register(pipelineRoute, { prefix: "/api/dashboard" });

  const { dashboardReportsRoutes } = await import("../routes/dashboard-reports.js");
  await app.register(dashboardReportsRoutes);

  return { app, cartridge, storage };
}
