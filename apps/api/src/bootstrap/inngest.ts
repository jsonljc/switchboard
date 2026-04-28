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
  decryptCredentials,
} from "@switchboard/db";
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
  MetaAdsClient,
  RealCrmDataProvider,
} from "@switchboard/ad-optimizer";
import type { CronDependencies, InstantFormAdapter } from "@switchboard/ad-optimizer";
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
  };

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
      createMetaTokenRefreshCron(metaTokenRefreshDeps),
      createReconciliationCron(reconciliationDeps),
      createStripeReconciliationCron(stripeReconciliationDeps),
      createLeadRetryCron(leadRetryDeps),
      createPcdRegistryBackfillCron(pcdRegistryBackfillDeps),
    ],
  });

  app.log.info("Inngest serve handler registered at /api/inngest");
}
