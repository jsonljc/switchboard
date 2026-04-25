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
  PrismaAssetRecordStore,
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
} from "@switchboard/ad-optimizer";
import type { CronDependencies } from "@switchboard/ad-optimizer";
import { createMetaTokenRefreshCron } from "../services/cron/meta-token-refresh.js";
import type { MetaTokenRefreshDeps } from "../services/cron/meta-token-refresh.js";
import { createReconciliationCron } from "../services/cron/reconciliation.js";
import type { ReconciliationCronDeps } from "../services/cron/reconciliation.js";

export async function registerInngest(app: FastifyInstance): Promise<void> {
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
    createCrmProvider: (_deploymentId) => ({
      // Stub CRM provider — real implementation in Task 11 when CRM queries are built
      getFunnelData: async () => ({
        campaignIds: [],
        leads: 0,
        qualified: 0,
        opportunities: 0,
        bookings: 0,
        closed: 0,
        revenue: 0,
        rates: {
          leadToQualified: 0,
          qualifiedToBooking: 0,
          bookingToClosed: 0,
          leadToClosed: 0,
        },
        coverage: {
          attributedContacts: 0,
          contactsWithEmailOrPhone: 0,
          contactsWithOpportunity: 0,
          contactsWithBooking: 0,
          contactsWithRevenueEvent: 0,
        },
      }),
      getBenchmarks: async () => ({
        leadToQualifiedRate: 0.4,
        qualifiedToBookingRate: 0.5,
        bookingToClosedRate: 0.25,
        leadToClosedRate: 0.06,
      }),
    }),
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
    ],
  });

  app.log.info("Inngest serve handler registered at /api/inngest");
}
