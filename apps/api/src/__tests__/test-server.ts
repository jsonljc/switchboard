import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";
import { actionsRoutes } from "../routes/actions.js";
import { actionLifecycleRoutes } from "../routes/action-lifecycle.js";
import { executeRoutes } from "../routes/execute.js";
import { approvalsRoutes } from "../routes/approvals.js";
import { policiesRoutes } from "../routes/policies.js";
import { auditRoutes } from "../routes/audit.js";
import { identityRoutes } from "../routes/identity.js";
import { recommendationsRoutes } from "../routes/recommendations.js";
import { revenueRoutes } from "../routes/revenue.js";
import { dashboardAgentsRoutes } from "../routes/dashboard-agents.js";
import { decisionsRoutes } from "../routes/decisions.js";
import { winsRoute } from "../routes/agent-home/wins.js";
import { pipelineRoute } from "../routes/agent-home/pipeline.js";
import { metricsRoute } from "../routes/agent-home/metrics.js";
import { greetingRoutes } from "../routes/greeting.js";
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
  agentHome,
} from "@switchboard/core";
import { createInMemoryOrgAgentEnablementStore } from "@switchboard/db";
import type {
  StorageContext,
  PolicyCache,
  ContactStore,
  HandoffStore,
  ConversationThreadStore,
  OpportunityStore,
  RevenueStore,
  TriggerStore,
  ConsentService,
  ContactConsentReader,
} from "@switchboard/core";
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
  ExecutionError,
  GovernanceCartridge,
  CartridgeManifestForRegistration,
} from "@switchboard/core/platform";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import {
  ObservableWorkTraceStore,
  TestContactStore,
  TestHandoffStore,
  TestThreadStore,
  TestOpportunityStore,
  TestRevenueStore,
  TestTriggerStore,
} from "./test-stores.js";

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
    opportunityStore?: OpportunityStore;
    revenueEventStore?: RevenueStore;
    triggerStore?: TriggerStore;
    reportCacheStore?: import("@switchboard/core/reports").ReportCacheStore;
    reportStores?: import("@switchboard/core/reports").ReportStores;
    reportInsightsProvider?: import("@switchboard/schemas").ReportInsightsProvider | null;
    greetingSignalStore?: import("@switchboard/core").agentHome.GreetingSignalStore;
    disqualificationHook?: Pick<
      import("@switchboard/core").DisqualificationResolutionHook,
      "confirm" | "dismiss"
    > | null;
    /** Test-only observer for the most recent ingress-persisted WorkTrace. */
    lastIngressTrace?: {
      intent: string;
      mode: string;
      outcome: string;
      organizationId: string;
      error?: Pick<ExecutionError, "code" | "message">;
    } | null;
    /** Test-only counter of WorkTrace persist() calls. */
    ingressTraceCount?: number;
  }
}

export interface TestContext {
  app: FastifyInstance;
  cartridge: TestCartridge;
  storage: StorageContext;
}

export interface BuildTestServerOptions {
  /** Override the opportunityStore decorator. Pass `null` to skip decoration entirely (tests the 503 path). */
  opportunityStore?: OpportunityStore | null;
  /** Provide a mock disqualificationHook for lifecycle-disqualifications ingress tests (Phase 1b.3).
   * Accepts Pick<DisqualificationResolutionHook,"confirm"|"dismiss"> so test mocks don't need
   * awkward `as unknown as InstanceType<...>` casts. */
  disqualificationHook?: Pick<
    import("@switchboard/core").DisqualificationResolutionHook,
    "confirm" | "dismiss"
  > | null;
  /** Provide a mock ConsentService for admin-consent ingress tests (Phase 1b.4).
   * When provided alongside `consentReader`, admin-consent routes are registered
   * and the service is threaded into `bootstrapOperatorIntents`. */
  consentService?: ConsentService;
  /** Provide a mock ContactConsentReader for admin-consent ingress tests (Phase 1b.4).
   * Required alongside `consentService` to register admin-consent routes. */
  consentReader?: ContactConsentReader;
  /** Provide a mock RevenueStore for revenue ingress tests (#654-B).
   * When provided alongside `outboxWriter`, the revenue intent is registered
   * and `app.revenueEventStore` is decorated with this store (instead of TestRevenueStore). */
  revenueStore?: RevenueStore;
  /** Provide a mock OutboxWriter for revenue ingress tests (#654-B).
   * Required alongside `revenueStore` for the revenue intent to register. */
  outboxWriter?: import("../bootstrap/operator-intents/revenue.js").OutboxWriter;
  /**
   * Transaction runner for the revenue handler. Defaults to a no-op sentinel
   * `async (fn) => fn(undefined)` so handler unit tests work without a real
   * Prisma client. Integration tests that want true rollback behaviour should
   * supply a real `prisma.$transaction` runner.
   */
  runInTransaction?: import("../bootstrap/operator-intents/revenue.js").RunInTransaction;
}

export async function buildTestServer(options: BuildTestServerOptions = {}): Promise<TestContext> {
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
  // No real Prisma in tests — routes that call getOrgTimezone(app.prisma, ...) will
  // get null and fall back to the default timezone ("Asia/Singapore").
  app.decorate("prisma", null);
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
  // Allow null override to test the 503 path (store not available).
  if (options.opportunityStore !== null) {
    app.decorate(
      "opportunityStore",
      options.opportunityStore !== undefined
        ? options.opportunityStore
        : new TestOpportunityStore(),
    );
  }
  app.decorate(
    "revenueEventStore",
    options.revenueStore !== undefined ? options.revenueStore : new TestRevenueStore(),
  );
  app.decorate("triggerStore", new TestTriggerStore());

  // Disqualification hook — provide via options for Phase 1b.3 ingress tests.
  // Undefined by default; tests that need it pass an explicit mock.
  if (options.disqualificationHook !== undefined) {
    app.decorate("disqualificationHook", options.disqualificationHook);
  }

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

  // In-memory greeting signal store — tests can seed via app.greetingSignalStore.setSignal()
  app.decorate("greetingSignalStore", new agentHome.InMemoryGreetingSignalStore());

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

  const workTraceStore = new ObservableWorkTraceStore();

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
  app.decorate("workTraceStore", workTraceStore);

  // Test-only ingress trace observer: the ObservableWorkTraceStore records the
  // most recent persisted WorkTrace summary AND counts persist() calls so
  // tests can assert "exactly one WorkTrace per route call" (Wave 2 Phase 1b
  // cleanup — one operator stage transition = one WorkTrace).
  Object.defineProperty(app, "lastIngressTrace", {
    get: () => workTraceStore.lastPersistedSummary,
    configurable: true,
  });
  Object.defineProperty(app, "ingressTraceCount", {
    get: () => workTraceStore.persistCount,
    configurable: true,
  });

  // Operator-direct ingress bootstrap — registers OperatorMutationMode +
  // operator.transition_opportunity_stage + operator.act_on_recommendation +
  // operator.confirm_disqualification + operator.dismiss_disqualification handlers.
  // All stores are optional; bootstrapOperatorIntents conditionally registers each
  // handler+intent internally. Always call so disqualification intents are wired
  // even when opportunityStore is absent (e.g. tests that pass null to skip 503 path).
  // Must run AFTER opportunityStore/recommendationStore/disqualificationHook decoration
  // and PlatformIngress wiring.
  const { bootstrapOperatorIntents } = await import("../bootstrap/operator-intents.js");
  bootstrapOperatorIntents({
    intentRegistry,
    modeRegistry,
    opportunityStore: app.opportunityStore ?? undefined,
    recommendationStore: app.recommendationStore,
    disqualificationHook: app.disqualificationHook ?? undefined,
    consentService: options.consentService,
    revenueStore: app.revenueEventStore ?? undefined,
    outboxWriter: options.outboxWriter,
    runInTransaction: options.runInTransaction ?? (async (fn) => fn(undefined)),
  });

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
  await app.register(actionLifecycleRoutes, { prefix: "/api/actions" });
  await app.register(executeRoutes, { prefix: "/api" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(policiesRoutes, { prefix: "/api/policies" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  await app.register(identityRoutes, { prefix: "/api/identity" });
  await app.register(recommendationsRoutes, { prefix: "/api/recommendations" });
  await app.register(revenueRoutes, { prefix: "/api" });
  await app.register(dashboardAgentsRoutes, { prefix: "/api/dashboard/agents" });
  await app.register(decisionsRoutes, { prefix: "/api/dashboard" });
  await app.register(winsRoute, { prefix: "/api/dashboard" });
  await app.register(pipelineRoute, { prefix: "/api/dashboard" });
  await app.register(metricsRoute, { prefix: "/api/dashboard" });
  await app.register(greetingRoutes, { prefix: "/api/dashboard" });

  const { dashboardReportsRoutes } = await import("../routes/dashboard-reports.js");
  await app.register(dashboardReportsRoutes);

  const { dashboardContactsRoutes } = await import("../routes/dashboard-contacts.js");
  await app.register(dashboardContactsRoutes);

  const { dashboardOpportunitiesRoutes } = await import("../routes/dashboard-opportunities.js");
  await app.register(dashboardOpportunitiesRoutes);

  const { dashboardContactDetailRoutes } = await import("../routes/dashboard-contact-detail.js");
  await app.register(dashboardContactDetailRoutes);

  const { dashboardAutomationsRoutes } = await import("../routes/dashboard-automations.js");
  await app.register(dashboardAutomationsRoutes);

  const { dashboardActivityRoutes } = await import("../routes/dashboard-activity.js");
  await app.register(dashboardActivityRoutes, { prefix: "/api/dashboard/activity" });

  // Lifecycle disqualifications routes (Phase 1b.3) — registered when test provides stores.
  // Tests that only need the POST ingress path (via app.disqualificationHook) can rely on
  // in-memory mocks; the GET route requires snapshotStore + transitionStore which are not
  // provided by default.
  if (app.disqualificationHook) {
    const { registerLifecycleDisqualificationsRoutes } =
      await import("../routes/lifecycle-disqualifications.js");
    await registerLifecycleDisqualificationsRoutes(app, {
      snapshotStore: {
        listPendingDisqualifications: async () => [],
      },
      transitionStore: {
        findLatestProposal: async () => null,
      },
    });
  }

  // Admin-consent routes (Phase 1b.4) — registered when test provides both
  // consentService (threaded into bootstrapOperatorIntents above) and
  // consentReader (used by the route for post-mutation state reads + the GET
  // endpoint). Mirrors the disqualificationHook conditional-registration pattern.
  if (options.consentService && options.consentReader) {
    const { registerAdminConsentRoutes } = await import("../routes/admin-consent.js");
    registerAdminConsentRoutes(app, {
      consentReader: options.consentReader,
    });
  }

  return { app, cartridge, storage };
}
