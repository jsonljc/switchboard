/* eslint-disable max-lines -- bootstrap module: accumulates Prisma store
   construction, Inngest function registration, and Fastify handler wiring
   for the entire async-job surface. Crossed the 600-line guideline when
   pattern-decay + canonical-merge crons were wired (PR-3.2b/PR-3.2d).
   Splitting requires a real design pass (store-construction helper +
   per-domain function registry); tracked as legacy debt for now, consistent
   with apps/api/src/app.ts and packages/core/src/orchestrator/propose-pipeline.ts. */
// apps/api/src/bootstrap/inngest.ts
import type { FastifyInstance } from "fastify";
import inngestFastify from "inngest/fastify";
import {
  PrismaCreativeJobStore,
  PrismaDeploymentStore,
  PrismaListingStore,
  PrismaDeploymentConnectionStore,
  PrismaAgentTaskStore,
  PrismaCreatorIdentityStore,
  PrismaProductIdentityStore,
  PrismaAssetRecordStore,
  PrismaCrmFunnelStore,
  PrismaDeploymentMemoryStore,
  PrismaRecommendationStore,
  PrismaRecommendationEmissionMirror,
  decryptCredentials,
} from "@switchboard/db";
import {
  GovernanceConfigSchema,
  PATTERN_DECAY_WINDOW_DAYS,
  resolveLifecycleTaggingMechanicalConfig,
} from "@switchboard/schemas";
import {
  emitRecommendation,
  executeDailyPatternDecay,
  getMetrics,
  type PatternDecayDependencies,
  type RecommendationInput,
  type StepTools as PatternDecayStepTools,
} from "@switchboard/core";
import { bootstrapLifecycle } from "./lifecycle.js";
import {
  inngestClient,
  createCreativeJobRunner,
  createModeDispatcher,
  createUgcJobRunner,
  KlingClient,
} from "@switchboard/creative-pipeline";
import {
  createWeeklyAuditCron,
  createDailyCheckCron,
  createDailySignalHealthCron,
  MetaAdsClient,
  RealCrmDataProvider,
  SignalHealthChecker,
} from "@switchboard/ad-optimizer";
import type {
  CronDependencies,
  SignalHealthCronDependencies,
  InstantFormAdapter,
} from "@switchboard/ad-optimizer";
import { createMetaTokenRefreshCron } from "../services/cron/meta-token-refresh.js";
import type { MetaTokenRefreshDeps } from "../services/cron/meta-token-refresh.js";
import {
  createReconciliationCron,
  createStripeReconciliationCron,
} from "../services/cron/reconciliation.js";
import type {
  ReconciliationCronDeps,
  StripeReconciliationDeps,
} from "../services/cron/reconciliation.js";
import { createLeadRetryCron } from "../services/cron/lead-retry.js";
import type { LeadRetryCronDeps } from "../services/cron/lead-retry.js";
import { createPcdRegistryBackfillCron } from "../services/cron/pcd-registry-backfill.js";
import type { PcdRegistryBackfillDeps } from "../services/cron/pcd-registry-backfill.js";
import { createLifecycleStalledSweepCron } from "../services/cron/lifecycle-stalled-sweep.js";

function requireInstantFormAdapter(adapter: InstantFormAdapter | undefined): InstantFormAdapter {
  if (!adapter) {
    throw new Error(
      "lead-retry cron requires instantFormAdapter (shared singleton from bootstrapContainedWorkflows)",
    );
  }
  return adapter;
}

export interface RegisterInngestOptions {
  /**
   * Shared singleton InstantFormAdapter from `bootstrapContainedWorkflows`.
   * The lead-retry cron MUST use this same instance so retry-path Contact
   * creation flows through the same PlatformIngress front door as the
   * primary webhook path. No parallel mutation paths.
   */
  instantFormAdapter?: InstantFormAdapter;
}

export async function registerInngest(
  app: FastifyInstance,
  options: RegisterInngestOptions = {},
): Promise<void> {
  if (!app.prisma) {
    app.log.warn("Inngest: skipping registration — no database connection");
    return;
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
  if (!apiKey) {
    app.log.warn(
      "Inngest: ANTHROPIC_API_KEY not set — creative pipeline stages will fail at runtime",
    );
  }

  const openaiApiKey = process.env["OPENAI_API_KEY"] ?? "";
  if (!openaiApiKey) {
    app.log.warn("Inngest: OPENAI_API_KEY not set — storyboard image generation will be skipped");
  }

  const jobStore = new PrismaCreativeJobStore(app.prisma);
  const creatorStore = new PrismaCreatorIdentityStore(app.prisma);
  const assetStore = new PrismaAssetRecordStore(app.prisma);
  const klingApiKey = process.env["KLING_API_KEY"] ?? "";
  const klingClient = klingApiKey ? new KlingClient({ apiKey: klingApiKey }) : undefined;

  // Ad Optimizer cron dependencies
  const deploymentStore = new PrismaDeploymentStore(app.prisma);
  const listingStore = new PrismaListingStore(app.prisma);
  const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
  const taskStore = new PrismaAgentTaskStore(app.prisma);

  // Pixel id can be captured in two operator-facing places:
  //   1. Meta-ads connection credentials (apps/dashboard/src/lib/
  //      service-field-configs.ts) — the OAuth-time field.
  //   2. Deployment.inputConfig.pixelId (packages/db/prisma/seed-marketplace.ts)
  //      — the ad-optimizer onboarding-wizard field.
  // Precedence: credentials → inputConfig. Credentials are the canonical
  // location (same record as accessToken+accountId, easier to keep in sync);
  // inputConfig is the fallback so operators who only wired the wizard don't
  // silently miss out on signal-health checks.
  const getDeploymentPixelId = async (deploymentId: string): Promise<string | null> => {
    const connections = await connectionStore.listByDeployment(deploymentId);
    const conn = connections.find((c) => c.type === "meta-ads");
    if (conn) {
      const creds = decryptCredentials(conn.credentials);
      const fromCreds = creds.pixelId;
      if (typeof fromCreds === "string" && fromCreds.length > 0) {
        return fromCreds;
      }
    }
    const deployment = await deploymentStore.findById(deploymentId);
    const inputConfig = (deployment?.inputConfig as Record<string, unknown> | undefined) ?? {};
    const fromInputConfig = inputConfig["pixelId"];
    return typeof fromInputConfig === "string" && fromInputConfig.length > 0
      ? fromInputConfig
      : null;
  };
  const createSignalHealthChecker = (creds: { accessToken: string }) =>
    new SignalHealthChecker({ accessToken: creds.accessToken });

  // Riley emission wiring (Wave B PR-1 substrate). Construct one mirror that
  // the weekly-audit cron's recommendationEmitter callback closes over. Every
  // emission performs an atomic dual-write: PendingActionRecord row + paired
  // WorkTrace row inside a single prisma.$transaction. The cronId below is
  // hardcoded to "ad-optimizer-weekly-audit" because executeWeeklyAudit is the
  // only Riley-emission path today (executeDailyCheck just polls account
  // summary; executeDailySignalHealthCheck does not emit recommendations).
  const recommendationStore = new PrismaRecommendationStore(app.prisma);
  const recommendationEmissionMirror = new PrismaRecommendationEmissionMirror(app.prisma);
  const rileyRecommendationEmitter = async (input: RecommendationInput) => {
    const result = await emitRecommendation(recommendationStore, input, {
      mirror: recommendationEmissionMirror,
      cronId: "ad-optimizer-weekly-audit",
    });
    return { surface: result.surface };
  };

  const adOptimizerDeps: CronDependencies = {
    listActiveDeployments: async () => {
      const listing = await listingStore.findBySlug("ad-optimizer");
      if (!listing) return [];
      const deployments = await deploymentStore.listByListing(listing.id, "active");
      return deployments.map((d) => ({
        id: d.id,
        organizationId: d.organizationId,
        inputConfig: (d.inputConfig as Record<string, unknown>) ?? {},
      }));
    },
    getDeploymentCredentials: async (deploymentId) => {
      const connections = await connectionStore.listByDeployment(deploymentId);
      const conn = connections.find((c) => c.type === "meta-ads");
      if (!conn) return null;
      const creds = decryptCredentials(conn.credentials);
      return {
        accessToken: creds.accessToken as string,
        accountId: creds.accountId as string,
      };
    },
    createAdsClient: (creds) => new MetaAdsClient(creds),
    createCrmProvider: (_deploymentId) => {
      // Real Prisma-backed provider. The Inngest function passes the resolved
      // `orgId` from the deployment record on every call, so a single shared
      // store + provider instance works for all deployments.
      const funnelStore = new PrismaCrmFunnelStore(app.prisma!);
      return new RealCrmDataProvider(funnelStore);
    },
    createInsightsProvider: (_adsClient) => ({
      // Stub insights provider — real implementation delegates to MetaCampaignInsightsProvider
      getCampaignLearningData: async () => ({
        effectiveStatus: "ACTIVE",
        learningPhase: false,
        lastModifiedDays: 30,
        optimizationEvents: 100,
      }),
      getTargetBreachStatus: async () => ({
        periodsAboveTarget: 0,
        granularity: "daily",
        isApproximate: false,
      }),
    }),
    saveAuditReport: async (deploymentId, report) => {
      const deployment = await deploymentStore.findById(deploymentId);
      if (!deployment) return;
      const task = await taskStore.create({
        deploymentId,
        organizationId: deployment.organizationId,
        listingId: deployment.listingId,
        category: "audit",
        input: {},
      });
      await taskStore.submitOutput(task.id, report as Record<string, unknown>);
      await taskStore.updateStatus(task.id, "completed");
    },
    getDeploymentPixelId,
    createSignalHealthChecker,
    recommendationEmitter: rileyRecommendationEmitter,
  };

  // Signal-health daily cron uses a slimmer dep set than the audit cron —
  // it only needs to list deployments, resolve creds + pixel, run the
  // checker, and persist the report.
  const signalHealthDeps: SignalHealthCronDependencies = {
    listActiveDeployments: adOptimizerDeps.listActiveDeployments,
    getDeploymentCredentials: adOptimizerDeps.getDeploymentCredentials,
    getDeploymentPixelId,
    createSignalHealthChecker,
    saveSignalHealthReport: async (deploymentId, report) => {
      const deployment = await deploymentStore.findById(deploymentId);
      if (!deployment) return;
      const task = await taskStore.create({
        deploymentId,
        organizationId: deployment.organizationId,
        listingId: deployment.listingId,
        category: "signal_health",
        input: {},
      });
      await taskStore.submitOutput(task.id, report as unknown as Record<string, unknown>);
      await taskStore.updateStatus(task.id, "completed");
    },
  };

  // Pattern-decay daily cron — pure executor lives in @switchboard/core;
  // the Prisma store is injected here at the bootstrap boundary so core
  // never imports from @switchboard/db (Layer 3 → Layer 4 forbidden).
  const patternDecayDeps: PatternDecayDependencies = {
    memoryStore: new PrismaDeploymentMemoryStore(app.prisma),
    now: () => new Date(),
    windowDays: PATTERN_DECAY_WINDOW_DAYS,
    decayAmount: 0.1,
    floor: 0.3,
    metrics: getMetrics(),
  };

  const dailyPatternDecayCron = inngestClient.createFunction(
    {
      id: "memory-daily-pattern-decay",
      name: "Memory Daily Pattern Decay",
      retries: 2,
      // 07:00 UTC — same slot as ad-optimizer signal-health to consolidate
      // the daily ops attention window.
      triggers: [{ cron: "0 7 * * *" }],
      // Function-level idempotency: combined with the DB-level lastDecayedAt
      // guard, double-firing is impossible across orchestrator and DB layers.
      idempotency: `pattern-decay-{event.ts | dateMath "yyyy-MM-dd"}`,
    },
    async ({ step }) => {
      await executeDailyPatternDecay(step as unknown as PatternDecayStepTools, patternDecayDeps);
    },
  );

  // Meta token refresh cron dependencies
  const metaTokenRefreshDeps: MetaTokenRefreshDeps = {
    listMetaConnections: async () => {
      const allConnections = await app.prisma!.deploymentConnection.findMany({
        where: { type: "meta-ads" },
      });
      return allConnections.map(
        (c: {
          id: string;
          deploymentId: string;
          type: string;
          status: string;
          credentials: string;
          metadata: unknown;
        }) => ({
          id: c.id,
          deploymentId: c.deploymentId,
          type: c.type,
          status: c.status,
          credentials: c.credentials,
          metadata: (c.metadata as Record<string, unknown>) ?? null,
        }),
      );
    },
    updateCredentials: async (id, credentials) => {
      await connectionStore.updateCredentials(id, credentials);
    },
    updateStatus: async (id, status) => {
      await connectionStore.updateStatus(id, status);
    },
    refreshTokenIfNeeded: async (config, currentToken, expiresAt) => {
      const { refreshTokenIfNeeded } = await import("@switchboard/ad-optimizer");
      return refreshTokenIfNeeded(config, currentToken, expiresAt);
    },
    getOAuthConfig: () => ({
      appId: process.env["META_APP_ID"] ?? "",
      appSecret: process.env["META_APP_SECRET"] ?? "",
      redirectUri: process.env["META_OAUTH_REDIRECT_URI"] ?? "",
    }),
  };

  // Reconciliation cron dependencies
  const reconciliationDeps: ReconciliationCronDeps = {
    listActiveOrganizations: async () => {
      const orgs = await app.prisma!.organizationConfig.findMany({
        where: { provisioningStatus: "active" },
        select: { id: true, name: true },
      });
      return orgs;
    },
    runReconciliation: async (orgId, dateRange) => {
      // Stub — full wiring requires booking/conversion/opportunity stores
      // Returns healthy by default; real implementation connects ReconciliationRunner
      return {
        organizationId: orgId,
        overallStatus: "healthy",
        checks: [],
        dateRangeFrom: dateRange.from,
        dateRangeTo: dateRange.to,
      };
    },
  };

  // Stripe reconciliation cron dependencies
  const stripeReconciliationDeps: StripeReconciliationDeps = {
    listSubscribedOrganizations: async () => {
      const orgs = await app.prisma!.organizationConfig.findMany({
        where: {
          stripeSubscriptionId: { not: null },
          subscriptionStatus: { notIn: ["none", "canceled"] },
        },
        select: {
          id: true,
          stripeSubscriptionId: true,
          subscriptionStatus: true,
          cancelAtPeriodEnd: true,
        },
      });
      return orgs
        .filter((o): o is typeof o & { stripeSubscriptionId: string } => !!o.stripeSubscriptionId)
        .map((o) => ({
          id: o.id,
          stripeSubscriptionId: o.stripeSubscriptionId,
          subscriptionStatus: o.subscriptionStatus,
          cancelAtPeriodEnd: o.cancelAtPeriodEnd ?? false,
        }));
    },
    retrieveStripeSubscription: async (subscriptionId) => {
      const { getStripe } = await import("../services/stripe-service.js");
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      const firstItem = sub.items.data[0];
      const periodEnd = firstItem?.current_period_end;
      return {
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        priceId: firstItem?.price.id ?? null,
      };
    },
    updateOrganization: async (orgId, data) => {
      await app.prisma!.organizationConfig.update({
        where: { id: orgId },
        data,
      });
    },
  };

  // Lead retry cron dependencies
  const leadRetryDeps: LeadRetryCronDeps = {
    findPendingLeads: async () => {
      const now = new Date();
      const records = await app.prisma!.pendingLeadRetry.findMany({
        where: {
          resolvedAt: null,
          nextRetryAt: { lte: now },
          attempts: { lt: 5 },
        },
        orderBy: { nextRetryAt: "asc" },
        take: 100,
      });
      return records.map(
        (r: {
          id: string;
          organizationId: string;
          leadId: string;
          adId: string;
          formId: string;
          reason: string;
          attempts: number;
          maxAttempts: number;
        }) => ({
          id: r.id,
          organizationId: r.organizationId,
          leadId: r.leadId,
          adId: r.adId,
          formId: r.formId,
          reason: r.reason,
          attempts: r.attempts,
          maxAttempts: r.maxAttempts,
        }),
      );
    },
    getOrgAccessToken: async (orgId) => {
      const deployment = await app.prisma!.agentDeployment.findFirst({
        where: { organizationId: orgId, status: "active" },
        select: { id: true },
      });
      if (!deployment) return null;
      const connections = await connectionStore.listByDeployment(deployment.id);
      const metaConn = connections.find((c) => c.type === "meta-ads" && c.status === "active");
      if (!metaConn) return null;
      const creds = decryptCredentials(metaConn.credentials);
      return (creds.accessToken as string) ?? null;
    },
    fetchLeadDetail: async (leadId, accessToken) => {
      const { fetchLeadDetail: fetchDetail } = await import("@switchboard/ad-optimizer");
      return fetchDetail(leadId, accessToken);
    },
    extractFieldValue: (fields, name) => {
      const f = fields?.find((x) => x.name === name);
      return f?.values?.[0];
    },
    resolveDeploymentId: async (orgId) => {
      const deployment = await app.prisma!.agentDeployment.findFirst({
        where: { organizationId: orgId, status: "active" },
        select: { id: true },
      });
      return deployment?.id ?? null;
    },
    instantFormAdapter: requireInstantFormAdapter(options.instantFormAdapter),
    markResolved: async (id) => {
      await app.prisma!.pendingLeadRetry.update({
        where: { id },
        data: { resolvedAt: new Date() },
      });
    },
    incrementAttempt: async (id, nextRetryAt) => {
      await app.prisma!.pendingLeadRetry.update({
        where: { id },
        data: { attempts: { increment: 1 }, nextRetryAt },
      });
    },
    markExhausted: async (id) => {
      await app.prisma!.pendingLeadRetry.update({
        where: { id },
        data: { resolvedAt: new Date(), attempts: { increment: 1 } },
      });
    },
  };

  // PCD Registry backfill cron dependencies
  const productIdentityStore = new PrismaProductIdentityStore(app.prisma);

  const pcdRegistryBackfillDeps: PcdRegistryBackfillDeps = {
    fetchJobsBatch: async (limit, orgId) => {
      const rows = await app.prisma!.creativeJob.findMany({
        where: {
          registryBackfilled: false,
          ...(orgId ? { organizationId: orgId } : {}),
        },
        take: limit,
        select: {
          id: true,
          organizationId: true,
          deploymentId: true,
          productDescription: true,
          productImages: true,
          registryBackfilled: true,
        },
      });
      return rows.map((r) => ({ ...r }));
    },
    stores: {
      productStore: {
        findOrCreateForJob: async (job) => {
          // Dedup: jobs in the same org with identical productDescription share one ProductIdentity row.
          const existing = await app.prisma!.productIdentity.findFirst({
            where: { orgId: job.organizationId, title: job.productDescription },
            select: { id: true },
          });
          if (existing) return existing;
          const created = await productIdentityStore.create({
            orgId: job.organizationId,
            title: job.productDescription,
            qualityTier: "url_imported",
            lockStatus: "draft",
          });
          return { id: created.id };
        },
      },
      creatorStore: {
        findOrCreateStockForDeployment: async (deploymentId) => {
          const existing = await app.prisma!.creatorIdentity.findFirst({
            where: { deploymentId, qualityTier: "stock" },
            select: { id: true },
          });
          if (existing) return existing;
          // Placeholder values are safe because Tier-1 stock avatars are gated to scripts/storyboards only — never reach video generation that would require a real heroImageAssetId or voice sample.
          const created = await creatorStore.create({
            deploymentId,
            name: "Stock Avatar (backfill)",
            identityRefIds: [],
            heroImageAssetId: "backfill_placeholder",
            identityDescription: "Backfilled stock avatar (Tier 1).",
            voice: {
              voiceId: "stock",
              provider: "elevenlabs",
              tone: "neutral",
              pace: "moderate",
              sampleUrl: "",
            },
            personality: { energy: "conversational", deliveryStyle: "natural" },
            appearanceRules: { hairStates: [], wardrobePalette: [] },
            environmentSet: [],
          });
          await creatorStore.setQualityTier(created.id, "stock");
          return { id: created.id };
        },
      },
      jobStore: {
        markRegistryBackfilled: (jobId, input) =>
          jobStore.markRegistryBackfilled(jobId, input) as unknown as Promise<{
            id: string;
            registryBackfilled: boolean;
            productIdentityId: string;
            creatorIdentityId: string;
          }>,
      },
    },
  };

  // ---------------------------------------------------------------------------
  // Phase 3a lifecycle.stalled-sweep cron dependencies
  // ---------------------------------------------------------------------------
  // The cron stays inert until a per-org governance flag flips
  // `lifecycleTagging.mechanical` to "on". This closure resolves the flag by
  // looking up any active deployment for the org and parsing its
  // `governanceConfig` JSON via GovernanceConfigSchema. Returns "off" when no
  // deployment exists, the config is null/invalid, or the flag is "off".
  // The cron caches readMode per-org per-sweep (see runStalledSweep), so this
  // hits the DB at most once per org per hour.
  const lifecycleReadMode: (orgId: string) => Promise<"on" | "off"> = async (orgId) => {
    try {
      const deployment = await app.prisma!.agentDeployment.findFirst({
        where: { organizationId: orgId },
        select: { governanceConfig: true },
      });
      if (!deployment?.governanceConfig) return "off";
      const parsed = GovernanceConfigSchema.safeParse(deployment.governanceConfig);
      if (!parsed.success) return "off";
      return resolveLifecycleTaggingMechanicalConfig(parsed.data).mode;
    } catch {
      return "off";
    }
  };

  // bootstrapLifecycle is the single source of truth for Phase 3a wiring. It
  // constructs the writer + attributor + snapshotStore + history reader and
  // invokes the five registrar callbacks. The registrars here are no-op
  // because the producer-side wiring is DEFERRED — see the DEFERRED comments
  // in apps/api/src/bootstrap/lifecycle.ts for each seat. The returned
  // `{ writer, history }` are used to register the stalled-sweep Inngest cron
  // alongside the other crons below.
  const { writer: lifecycleWriter, history: lifecycleHistory } = bootstrapLifecycle({
    prisma: app.prisma,
    readMode: lifecycleReadMode,
    registerVerdictWriteHook: () => {},
    registerBookingCreateHook: () => {},
    registerInboundMessageHook: () => {},
    registerOperatorTakeoverHook: () => {},
    registerThreadInitHook: () => {},
    registerCron: () => {},
    // Phase 3b: this inngest seat only consumes writer/history from the bootstrap result.
    // governanceConfigResolver is intentionally stubbed here: no qualification capability
    // check runs through this inngest path — the real hook wiring lives in bootstrapSkillMode
    // (apps/api/src/bootstrap/skill-mode.ts) which uses createLifecycleGovernanceConfigResolver.
    playbookReader: { readForOrganization: async () => null },
    governanceConfigResolver: { resolve: async () => null },
  });

  await app.register(inngestFastify, {
    client: inngestClient,
    functions: [
      createModeDispatcher(),
      createCreativeJobRunner(jobStore, { apiKey }, openaiApiKey ? { openaiApiKey } : undefined),
      createUgcJobRunner({
        jobStore,
        creatorStore,
        deploymentStore: {
          findById: async (id: string) => {
            const deployment = await deploymentStore.findById(id);
            if (!deployment) return null;
            const listing = await listingStore.findById(deployment.listingId);
            return {
              listing: listing ? { trustScore: listing.trustScore } : undefined,
              type: "standard",
            };
          },
        },
        llmConfig: { apiKey },
        klingClient,
        assetStore,
      }),
      createWeeklyAuditCron(adOptimizerDeps),
      createDailyCheckCron(adOptimizerDeps),
      createDailySignalHealthCron(signalHealthDeps),
      dailyPatternDecayCron,
      createMetaTokenRefreshCron(metaTokenRefreshDeps),
      createReconciliationCron(reconciliationDeps),
      createStripeReconciliationCron(stripeReconciliationDeps),
      createLeadRetryCron(leadRetryDeps),
      createPcdRegistryBackfillCron(pcdRegistryBackfillDeps),
      createLifecycleStalledSweepCron({
        prisma: app.prisma,
        writer: lifecycleWriter,
        history: lifecycleHistory,
        readMode: lifecycleReadMode,
      }),
    ],
  });

  app.log.info("Inngest serve handler registered at /api/inngest");
}
