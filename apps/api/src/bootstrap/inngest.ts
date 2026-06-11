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
  PrismaConnectionStore,
  PrismaAgentTaskStore,
  PrismaCreatorIdentityStore,
  PrismaProductIdentityStore,
  PrismaAssetRecordStore,
  PrismaCrmFunnelStore,
  PrismaDeploymentMemoryStore,
  PrismaMiraCreativeReadModelReader,
  PrismaRecommendationStore,
  PrismaRecommendationEmissionMirror,
  PrismaRecommendationOutcomeStore,
  PrismaAttributableRecommendationStore,
  PrismaScheduledFollowUpStore,
  PrismaScheduledReminderStore,
  PrismaBookingStore,
  PrismaConversionRecordStore,
  PrismaOpportunityStore,
  PrismaReconciliationStore,
  PrismaBusinessFactsStore,
  PrismaOperationalStateStore,
  PrismaFailedMessageRetentionStore,
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
  makeOnFailureHandler,
  NoopOperatorAlerter,
  PrismaDeploymentResolver,
  type AsyncFailureContext,
  type OperatorAlerter,
  type PatternDecayDependencies,
  type RecommendationInput,
  type StepTools as PatternDecayStepTools,
} from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import { bootstrapLifecycle } from "./lifecycle.js";
import {
  inngestClient,
  createCreativeJobRunner,
  createModeDispatcher,
  createUgcJobRunner,
  KlingClient,
  HeyGenClient,
} from "@switchboard/creative-pipeline";
import {
  createWeeklyAuditCron,
  createDailyCheckCron,
  createDailySignalHealthCron,
  createRileyOutcomeAttributionDispatch,
  MetaAdsClient,
  RealCrmDataProvider,
  SignalHealthChecker,
  MetaCampaignInsightsProvider,
} from "@switchboard/ad-optimizer";
import type {
  CronDependencies,
  SignalHealthCronDependencies,
  InstantFormAdapter,
  RecommendationHandoffSubmitter,
  RileyPauseSubmitter,
} from "@switchboard/ad-optimizer";
import { synthesizeCreativeBrief } from "../services/workflows/creative-brief-synthesis.js";
import { resolveHandoffBrief } from "../services/workflows/handoff-brief-enrichment.js";
import type { RecommendationHandoffSubmitInput } from "../services/workflows/recommendation-handoff-request.js";
import type { RileyPauseSubmitInput } from "../services/workflows/riley-pause-submit-request.js";
import { buildRileyPauseSubmitter } from "./riley-pause-submitter.js";
import { buildRileyCredentialResolver } from "./riley-credential-resolver.js";
import { createMetaTokenRefreshCron } from "../services/cron/meta-token-refresh.js";
import type { MetaTokenRefreshDeps } from "../services/cron/meta-token-refresh.js";
import { resolveMetaOAuthConfig } from "../utils/meta-oauth-config.js";
import {
  createDlqRetentionPurgeCron,
  resolveRetentionWindows,
} from "../services/cron/dlq-retention-purge.js";
import type { DlqRetentionPurgeDeps } from "../services/cron/dlq-retention-purge.js";
import {
  createCreativePublishFunction,
  type CreativePublishFunctionDeps,
} from "../services/creative-publish-function.js";
import { assertPublishable } from "../services/creative-publish-preconditions.js";
import {
  buildRunReconciliation,
  createReconciliationCron,
  createStripeReconciliationCron,
} from "../services/cron/reconciliation.js";
import type {
  ReconciliationCronDeps,
  StripeReconciliationDeps,
} from "../services/cron/reconciliation.js";
import { createLeadRetryCron } from "../services/cron/lead-retry.js";
import type { LeadRetryCronDeps } from "../services/cron/lead-retry.js";
import { createScheduledFollowUpDispatchCron } from "../services/cron/scheduled-follow-up-dispatch.js";
import type {
  ScheduledFollowUpDispatchDeps,
  SubmitScheduledFollowUp,
} from "../services/cron/scheduled-follow-up-dispatch.js";
import { createAppointmentReminderDispatchCron } from "../services/cron/appointment-reminder-dispatch.js";
import type { AppointmentReminderDispatchDeps } from "../services/cron/appointment-reminder-dispatch.js";
import type { ReminderSendSubmitInput } from "../services/workflows/reminder-send-request.js";
import { createPcdRegistryBackfillCron } from "../services/cron/pcd-registry-backfill.js";
import type { PcdRegistryBackfillDeps } from "../services/cron/pcd-registry-backfill.js";
import { createLifecycleStalledSweepCron } from "../services/cron/lifecycle-stalled-sweep.js";
import {
  createRileyOutcomeAttributionWorker,
  bindRileyOutcomeOrchestrator,
} from "../services/cron/riley-outcome-attribution.js";
import { createMetaInsightsProviderForOrg } from "../services/cron/meta-insights-adapter.js";
import {
  createCreativeAttributionDispatch,
  createCreativeAttributionWorker,
  resolveMetaAdsConnectionCredentials,
} from "../services/cron/creative-attribution.js";
import {
  createMiraSelfBriefDispatch,
  createMiraSelfBriefWorker,
} from "../services/cron/mira-self-brief.js";
import { isAgentHomeAccessible } from "../lib/agent-home-access.js";
import { createCreativeTasteSweep } from "../services/cron/creative-taste-sweep.js";
import { buildCreativeTasteProvider } from "../services/creative-taste-context.js";
import { buildCreativeAssetStorage } from "../lib/creative-asset-storage.js";

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
  /**
   * Operator alerter for async failure notifications. Falls back to
   * NoopOperatorAlerter when not provided (development / test environments).
   */
  operatorAlerter?: OperatorAlerter;
  /**
   * Top-level submit closure for the scheduled-follow-up dispatch cron.
   * Built in bootstrapContainedWorkflows and threaded here so the cron
   * submits through the same PlatformIngress front door as all other
   * governed work. No parentWorkUnitId — cron work units are trace roots.
   */
  submitScheduledFollowUp?: SubmitScheduledFollowUp;
  /**
   * Top-level submit closure for the appointment-reminder dispatch cron.
   * Built in bootstrapContainedWorkflows and threaded here so the cron
   * submits through the same PlatformIngress front door as all other
   * governed work. No parentWorkUnitId — cron work units are trace roots.
   */
  submitScheduledReminder?: (input: ReminderSendSubmitInput) => Promise<SubmitWorkResponse>;
  /**
   * Top-level submit closure for the Riley weekly-audit cron's agent handoff
   * (Contract 3). Built in bootstrapContainedWorkflows and threaded here so the cron
   * submits through the same PlatformIngress front door. No parentWorkUnitId — cron
   * work units are trace roots. Returns null when Riley abstains.
   */
  submitRecommendationHandoff?: (
    input: RecommendationHandoffSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse | null>;
  /**
   * Top-level submit closure for the Phase-C pause initiator. Built in
   * bootstrapContainedWorkflows and threaded here so the cron submits through
   * the same PlatformIngress front door. Returns null when Riley abstains
   * (class eligibility / floors in the builder). No parentWorkUnitId — cron
   * work units are trace roots.
   */
  submitRileyPause?: (
    input: RileyPauseSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse | null>;
  /**
   * Top-level submit closures for the slice-4 mira weekly self-brief loop.
   * Built in bootstrapContainedWorkflows and threaded here so the cron
   * submits through the same PlatformIngress front door. The compose work
   * unit is a trace root; the concept draft carries parentWorkUnitId.
   */
  submitMiraBriefCompose?: (
    input: import("../services/workflows/mira-self-brief-request.js").MiraBriefComposeSubmitInput,
    deployment?: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse>;
  submitMiraConceptDraft?: (
    input: import("../services/workflows/mira-self-brief-request.js").MiraConceptDraftSubmitInput,
    deployment?: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse>;
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

  // Optional creative-pipeline model override (Mira polished + UGC). Empty or
  // unset becomes undefined, so the package's centralized default
  // (call-claude.ts DEFAULT_MODEL) applies. Packages must not read env per the
  // dependency-layer rule, so the apps layer reads it and threads it via LLMConfig.
  const creativeModel = process.env["CREATIVE_PIPELINE_MODEL"]?.trim() || undefined;

  const openaiApiKey = process.env["OPENAI_API_KEY"] ?? "";
  if (!openaiApiKey) {
    app.log.warn(
      "Inngest: OPENAI_API_KEY not set; storyboard image generation and pro-tier whisper captions will be skipped",
    );
  }

  const jobStore = new PrismaCreativeJobStore(app.prisma);
  const creatorStore = new PrismaCreatorIdentityStore(app.prisma);
  const assetStore = new PrismaAssetRecordStore(app.prisma);
  const klingApiKey = process.env["KLING_API_KEY"] ?? "";
  const klingClient = klingApiKey ? new KlingClient({ apiKey: klingApiKey }) : undefined;
  // Real HeyGen avatar provider (slice-3 spec 3.5): routing only selects
  // heygen for talking-head specs whose creator carries a heygen: ref, so an
  // unset key simply leaves avatar routing dormant (kling-only).
  const heygenApiKey = process.env["HEYGEN_API_KEY"] ?? "";
  const heygenClient = heygenApiKey ? new HeyGenClient({ apiKey: heygenApiKey }) : undefined;
  // Durable storage for assembled creatives (NOT the PrismaAssetRecordStore above).
  // Injected into the polished runner; undefined when CREATIVE_ASSET_* env is unset.
  const assetStorage = buildCreativeAssetStorage(app.log);

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
  // WorkTrace row inside a single prisma.$transaction. The emission context
  // (cronId + deploymentId) is bound at the cron call site per loop iteration —
  // see executeWeeklyAudit's per-deployment EmissionContext — so this closure
  // does not hardcode either field.
  const recommendationStore = new PrismaRecommendationStore(app.prisma);
  const recommendationEmissionMirror = new PrismaRecommendationEmissionMirror(app.prisma);

  // Riley PR-3: outcome attribution stores (Task 10)
  const recommendationOutcomeStore = new PrismaRecommendationOutcomeStore(app.prisma);
  const attributableRecommendationStore = new PrismaAttributableRecommendationStore(app.prisma);

  // Riley v3 slice 4c: operational-state reads (the 4a substrate; first and
  // only app-layer construction of this store). One store, two injection
  // points: getLatest feeds RevenueState.businessContextFreshness in the
  // weekly audit; the window read feeds businessContextStable in the
  // outcome-attribution worker. Read-only; Riley stays advisory.
  const operationalStateStore = new PrismaOperationalStateStore(app.prisma);
  const rileyRecommendationEmitter = async (
    input: RecommendationInput,
    ctx: { cronId: string; deploymentId?: string },
  ) => {
    const result = await emitRecommendation(recommendationStore, input, {
      mirror: recommendationEmissionMirror,
      cronId: ctx.cronId,
      ...(ctx.deploymentId ? { deploymentId: ctx.deploymentId } : {}),
    });
    return { surface: result.surface, id: result.id };
  };

  // PR2 Gate-4: per-campaign booked-VALUE provider for the weekly audit's
  // trueROAS reporting. A single shared store works for all deployments (the
  // audit passes the resolved orgId per call); structurally satisfies the
  // ad-optimizer BookedValueByCampaignProvider port.
  const bookedValueByCampaignStore = new PrismaConversionRecordStore(app.prisma!);

  // Riley → agent recommendation handoff. The cron (via the audit-runner sink) calls
  // this for each EMITTED creative recommendation that clears the abstention. We
  // resolve a fresh creative brief per handoff (BusinessFacts + medspa fallback) and
  // route through the top-level submit closure built in bootstrapContainedWorkflows
  // (parking for mandatory human approval). Best-effort: a handoff failure is caught
  // + logged so it never breaks the weekly audit.
  const businessFactsStore = new PrismaBusinessFactsStore(app.prisma);
  const recommendationHandoffSubmitter: RecommendationHandoffSubmitter = async (candidate) => {
    if (!options.submitRecommendationHandoff) return;
    try {
      // Slice-4 (spec 3.8): under MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED the brain
      // composes the brief BEFORE the mandatory-approval park (so the human
      // approves what dispatches); every degrade path falls back to the shipped
      // BusinessFacts synthesis. Flag off = byte-identical pre-slice-4 behavior.
      // The synthesis itself stays a cheap indexed read, resolved per handoff so
      // an operator's BusinessFacts edits take effect on the next run.
      const brief = await resolveHandoffBrief({
        // The raw candidate is a structural superset of HandoffBriefCandidate;
        // passing it whole lets the compiler pin the field mapping (a
        // same-typed field swap in a hand re-map would ship silently).
        candidate,
        readFlag: () => process.env["MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED"] === "true",
        synthesize: async () =>
          synthesizeCreativeBrief(await businessFactsStore.get(candidate.organizationId)),
        submitCompose:
          options.submitMiraBriefCompose ??
          (() => Promise.reject(new Error("submitMiraBriefCompose not wired"))),
        warn: (msg: string) => app.log.warn(msg),
      });
      const input: RecommendationHandoffSubmitInput = {
        organizationId: candidate.organizationId,
        recommendationId: candidate.recommendationId,
        actionType: candidate.actionType,
        campaignId: candidate.campaignId,
        rationale: candidate.rationale,
        evidence: candidate.evidence,
        learningPhaseActive: candidate.learningPhaseActive,
        brief,
      };
      await options.submitRecommendationHandoff(input, {
        deploymentId: candidate.deploymentId,
        skillSlug: "ad-optimizer",
      });
    } catch (err) {
      app.log.warn(
        `[inngest] Riley recommendation handoff failed for rec=${candidate.recommendationId}: ${String(err)}`,
      );
    }
  };

  // Phase-C pause initiator: the testable factory owns the branch order
  // (approvalRequired-before-result, entitlement named skip, loud deny +
  // unexpected-execute alarms). See bootstrap/riley-pause-submitter.ts.
  const rileyPauseSubmitter: RileyPauseSubmitter = buildRileyPauseSubmitter({
    submitRileyPause: options.submitRileyPause,
    log: app.log,
  });

  // Riley credential resolver (Tier-0 PR 0.1): the primary source is the
  // deployment-scoped DeploymentConnection (`connectionStore`); the pilot
  // fallback is the org-level Connection(serviceId="meta-ads") an operator
  // enters in the Settings UI. A needs_reauth/revoked connection is skipped so
  // a dead token is never used (and never poisons the weekly fleet audit).
  const orgConnectionStore = new PrismaConnectionStore(app.prisma!);
  const getDeploymentCredentials = buildRileyCredentialResolver({
    deploymentConnectionStore: connectionStore,
    orgConnectionStore,
    resolveOrgId: async (deploymentId) => {
      const deployment = await deploymentStore.findById(deploymentId);
      return deployment?.organizationId ?? null;
    },
    decrypt: (blob) => {
      const creds = decryptCredentials(blob);
      return {
        accessToken: creds.accessToken as string,
        accountId: creds.accountId as string,
      };
    },
  });

  const adOptimizerDeps: CronDependencies = {
    listActiveDeployments: async () => {
      const listing = await listingStore.findBySlug("ad-optimizer");
      if (!listing) return [];
      const deployments = await deploymentStore.listByListing(listing.id, "active");
      return deployments.map((d) => ({
        id: d.id,
        organizationId: d.organizationId,
        inputConfig: (d.inputConfig as Record<string, unknown>) ?? {},
        // Phase-C per-org dispatch flag. Strict === true: absent/null/anything
        // else stays OFF. Flips only via scripts/riley-pause-flag.ts (audited).
        pauseSelfExecutionEnabled:
          ((d.governanceSettings as Record<string, unknown> | null)?.[
            "pauseSelfExecutionEnabled"
          ] ?? false) === true,
      }));
    },
    getDeploymentCredentials,
    createAdsClient: (creds) => new MetaAdsClient(creds),
    createCrmProvider: (_deploymentId) => {
      // Real Prisma-backed provider. The Inngest function passes the resolved
      // `orgId` from the deployment record on every call, so a single shared
      // store + provider instance works for all deployments.
      const funnelStore = new PrismaCrmFunnelStore(app.prisma!);
      return new RealCrmDataProvider(funnelStore);
    },
    createInsightsProvider: (adsClient) => new MetaCampaignInsightsProvider(adsClient),
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
      await taskStore.submitOutput(
        deployment.organizationId,
        task.id,
        report as Record<string, unknown>,
      );
      await taskStore.updateStatus(deployment.organizationId, task.id, "completed");
    },
    getDeploymentPixelId,
    createSignalHealthChecker,
    recommendationEmitter: rileyRecommendationEmitter,
    bookedValueByCampaignProvider: bookedValueByCampaignStore,
    recommendationHandoffSubmitter,
    // Kill switch: RILEY_PAUSE_SELF_EXECUTION_ENABLED=true wires the pause
    // initiator; default absent = the deploy is dark (the per-deployment
    // governanceSettings flag then gates per org). Both default OFF.
    ...(process.env["RILEY_PAUSE_SELF_EXECUTION_ENABLED"] === "true"
      ? { rileyPauseSubmitter }
      : {}),
    getLatestOperationalState: (organizationId) => operationalStateStore.getLatest(organizationId),
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
      await taskStore.submitOutput(
        deployment.organizationId,
        task.id,
        report as unknown as Record<string, unknown>,
      );
      await taskStore.updateStatus(deployment.organizationId, task.id, "completed");
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

  // ---------------------------------------------------------------------------
  // Shared AsyncFailureContext — constructed once here; consumed by onFailure
  // wiring for Class-A, Class-B, and Class-E Inngest functions (Phase 3B failure contract).
  // ---------------------------------------------------------------------------
  const asyncFailure: AsyncFailureContext = {
    auditLedger: app.auditLedger,
    operatorAlerter: options.operatorAlerter ?? new NoopOperatorAlerter(),
    inngest: { send: (e) => inngestClient.send(e) },
  };

  // creative-publish: the dead-lettered Inngest function that runs the rate-limited Meta
  // draft chain off the approval-response path (go-live blocker #3). Deps mirror the
  // former inline-handler wiring; assertPublishable re-resolves fresh credentials inside
  // the function (never serialized into Inngest step state).
  const creativePublishFunctionDeps: CreativePublishFunctionDeps = {
    jobStore: new PrismaCreativeJobStore(
      app.prisma as unknown as ConstructorParameters<typeof PrismaCreativeJobStore>[0],
    ),
    assertPublishable: (organizationId, jobId) =>
      assertPublishable(
        {
          prisma: app.prisma as unknown as import("@switchboard/db").PrismaClient,
          decrypt: (e) => decryptCredentials(e as string),
        },
        organizationId,
        jobId,
      ),
    makeAdsClient: (cfg) => new MetaAdsClient(cfg),
    fetchAsset: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const type = (res.headers.get("content-type") ?? "").startsWith("image/")
        ? ("image" as const)
        : ("video" as const);
      return { buffer, type };
    },
    failure: asyncFailure,
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
      onFailure: makeOnFailureHandler(
        {
          functionId: "memory-daily-pattern-decay",
          riskCategory: "low",
          alert: false,
          emitEvent: false,
        },
        asyncFailure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => {
      await executeDailyPatternDecay(step as unknown as PatternDecayStepTools, patternDecayDeps);
    },
  );

  // Meta token refresh cron dependencies
  const metaTokenRefreshDeps: MetaTokenRefreshDeps = {
    failure: asyncFailure,
    listMetaConnections: async () => {
      const allConnections = await app.prisma!.deploymentConnection.findMany({
        where: { type: "meta-ads" },
        include: { deployment: true },
      });
      return allConnections.map(
        (c: {
          id: string;
          deploymentId: string;
          type: string;
          status: string;
          credentials: string;
          metadata: unknown;
          deployment: { organizationId: string };
        }) => ({
          id: c.id,
          organizationId: c.deployment.organizationId,
          deploymentId: c.deploymentId,
          type: c.type,
          status: c.status,
          credentials: c.credentials,
          metadata: (c.metadata as Record<string, unknown>) ?? null,
        }),
      );
    },
    updateCredentials: async (organizationId, id, credentials, metadata) => {
      await connectionStore.updateCredentials(organizationId, id, credentials, metadata);
    },
    updateStatus: async (organizationId, id, status) => {
      await connectionStore.updateStatus(organizationId, id, status);
    },
    refreshTokenIfNeeded: async (config, currentToken, expiresAt) => {
      const { refreshTokenIfNeeded } = await import("@switchboard/ad-optimizer");
      return refreshTokenIfNeeded(config, currentToken, expiresAt);
    },
    // Resolve through the shared resolver so the cron honors the same META_* canonical / FACEBOOK_*
    // deprecated-alias precedence the OAuth route uses (D10-4); throwing on missing config is fine
    // here, the per-connection refresh catch turns it into a needs_reauth + operator alert.
    getOAuthConfig: () => resolveMetaOAuthConfig(process.env),
    notifyOperator: async (message, context) => {
      const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
      await asyncFailure.operatorAlerter?.alert({
        errorType: "async_job_retry_exhausted",
        severity: "warning",
        errorMessage: message,
        deploymentId: asString(context["deploymentId"]),
        organizationId: asString(context["organizationId"]),
        retryable: true,
        occurredAt: new Date().toISOString(),
        source: "inngest_function",
      });
    },
  };

  // Dead-letter-queue retention purge (PDPA F6). Deletes aged FailedMessage rows
  // (terminal-status past the soft window OR any-status past the hard cap) so the
  // DLQ — which stores the entire inbound webhook (patient text + phone) — does
  // not retain PII forever. Cross-tenant by design; a thin orchestrator over the
  // batched db-store purge. Windows env-configurable (defaults 30 / 90 days).
  // Completes the F5/F6 retention+deletion pair (F5 = per-contact erasure).
  const failedMessageRetentionStore = new PrismaFailedMessageRetentionStore(app.prisma);
  const { soft: dlqSoftDays, hard: dlqHardDays } = resolveRetentionWindows(
    process.env["DLQ_RETENTION_DAYS"],
    process.env["DLQ_HARD_RETENTION_DAYS"],
  );
  const dlqRetentionPurgeDeps: DlqRetentionPurgeDeps = {
    failure: asyncFailure,
    purge: (input) => failedMessageRetentionStore.purgeExpired(input),
    softRetentionDays: dlqSoftDays,
    hardRetentionDays: dlqHardDays,
    logger: { info: (msg) => app.log.info(msg), warn: (msg) => app.log.warn(msg) },
  };

  // Reconciliation cron dependencies
  const reconciliationDeps: ReconciliationCronDeps = {
    failure: asyncFailure,
    listActiveOrganizations: async () => {
      const orgs = await app.prisma!.organizationConfig.findMany({
        where: { provisioningStatus: "active" },
        select: { id: true, name: true },
      });
      return orgs;
    },
    runReconciliation: buildRunReconciliation({
      bookingStore: new PrismaBookingStore(app.prisma!),
      conversionRecordStore: new PrismaConversionRecordStore(app.prisma!),
      opportunityStore: new PrismaOpportunityStore(app.prisma!),
      reconciliationStore: new PrismaReconciliationStore(app.prisma!),
    }),
  };

  // Stripe reconciliation cron dependencies
  const stripeReconciliationDeps: StripeReconciliationDeps = {
    failure: asyncFailure,
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
    failure: asyncFailure,
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

  // Scheduled follow-up dispatch cron dependencies
  const followUpStore = new PrismaScheduledFollowUpStore(app.prisma);
  const scheduledFollowUpDispatchDeps: ScheduledFollowUpDispatchDeps = {
    failure: asyncFailure,
    findDueFollowUps: () => followUpStore.findDue(new Date(), 100),
    submitFollowUpSend: (input) => {
      if (!options.submitScheduledFollowUp) {
        throw new Error("submitScheduledFollowUp not wired");
      }
      return options.submitScheduledFollowUp(input);
    },
    createFollowUp: (input) => followUpStore.create(input),
    markSent: (id) => followUpStore.markSent(id),
    markSkipped: (id, reason) => followUpStore.markSkipped(id, reason),
    markFailed: (id, error, nextRetryAt) => followUpStore.markFailed(id, error, nextRetryAt),
    markDeferred: (id, reason, nextRetryAt) => followUpStore.markDeferred(id, reason, nextRetryAt),
  };

  // Appointment reminder dispatch cron dependencies
  const scheduledReminderStore = new PrismaScheduledReminderStore(app.prisma);
  const bookingStore = new PrismaBookingStore(app.prisma);
  const appointmentReminderDispatchDeps: AppointmentReminderDispatchDeps = {
    failure: asyncFailure,
    findUpcomingConfirmed: (start, end) => bookingStore.findUpcomingConfirmed(start, end),
    findReminderByDedupeKey: (k) => scheduledReminderStore.findByDedupeKey(k),
    createReminder: (input) => scheduledReminderStore.create(input),
    submitReminderSend: (input) => {
      if (!options.submitScheduledReminder) {
        throw new Error("submitScheduledReminder not wired");
      }
      return options.submitScheduledReminder(input);
    },
    markSent: (id) => scheduledReminderStore.markSent(id),
    markSkipped: (id, reason) => scheduledReminderStore.markSkipped(id, reason),
    markFailed: (id, error) => scheduledReminderStore.markFailed(id, error),
  };

  // PCD Registry backfill cron dependencies
  const productIdentityStore = new PrismaProductIdentityStore(app.prisma);

  const pcdRegistryBackfillDeps: PcdRegistryBackfillDeps = {
    failure: asyncFailure,
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
          // Placeholder values are safe: Kling t2v consumes no identity fields, and
          // since slice-3 generateDirection falls back to neutral defaults on empty
          // arrays (no longer crashes), a placeholder reaching video generation
          // produces a neutral-direction clip. Identity-requiring providers (PR-4
          // HeyGen) gate on explicit identityRefIds this placeholder never has.
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
        markRegistryBackfilled: (organizationId, jobId, input) =>
          jobStore.markRegistryBackfilled(organizationId, jobId, input) as unknown as Promise<{
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

  // ---------------------------------------------------------------------------
  // Riley PR-3: outcome-attribution dispatch + per-org worker (Task 10)
  // ---------------------------------------------------------------------------
  // Dispatch cron fires daily at 07:00 UTC and emits one "riley.outcome.attribute"
  // event per org that has acted Riley recommendations. The per-org worker picks
  // up each event and runs the pure attribution orchestrator from @switchboard/core.
  // Kill-switch: set RILEY_OUTCOME_ATTRIBUTION_ENABLED=true to enable; default off
  // so the deploy is dark until the bake period completes.
  const rileyOutcomeDispatch = createRileyOutcomeAttributionDispatch(
    {
      listRileyOrgs: () => listRileyActiveOrgs(app.prisma!),
      sendEvent: (event: { name: string; data: Record<string, unknown> }) =>
        inngestClient.send(event),
    },
    makeOnFailureHandler(
      {
        functionId: "riley-outcome-attribution-dispatch",
        eventDomain: "riley.outcome-attribution.dispatch",
        riskCategory: "low",
        alert: false,
      },
      asyncFailure,
    ) as (arg: unknown) => Promise<void>,
  );

  const rileyOutcomeWorker = createRileyOutcomeAttributionWorker({
    failure: asyncFailure,
    runRileyOutcomeAttribution: bindRileyOutcomeOrchestrator({
      recommendationStore: attributableRecommendationStore,
      createInsightsProvider: (orgId) => createMetaInsightsProviderForOrg(orgId, app.prisma!),
      outcomeStore: recommendationOutcomeStore,
      operationalStateReader: operationalStateStore,
      // Slice 4d: the CRM-side second estimate for outcome corroboration.
      // The store instance already exists for the audit's booked-value
      // provider; its getBookedStatsForOrgWindow satisfies the core reader
      // interface structurally.
      orgBookedStatsReader: bookedValueByCampaignStore,
    }),
    readEnabledFlag: () => process.env["RILEY_OUTCOME_ATTRIBUTION_ENABLED"] === "true",
    logger: app.log,
  });

  // ---------------------------------------------------------------------------
  // Mira slice 2: per-creative attribution dispatch + per-org worker
  // ---------------------------------------------------------------------------
  // Dispatch fires daily at 06:30 UTC and emits one
  // "creative-pipeline/attribution.refresh" event per org that has published
  // creatives (metaCampaignId set by the slice-1 publish path). The per-org
  // worker joins ONE account-level campaign-insights call to internal booked
  // conversions (the 1:1 dedicated-campaign join) and persists a typed
  // pastPerformance row per published job.
  // Kill-switch: set CREATIVE_ATTRIBUTION_ENABLED=true to enable; default off
  // so the deploy is dark until deliberately enabled (the Riley bake pattern).
  // Both halves carry the Class-E failure contract (audit always, no domain
  // event): the projection is rebuilt by the next daily run and a
  // creative.attribution.*.failed event would have zero consumers.
  const creativeAttributionDispatch = createCreativeAttributionDispatch(
    {
      listPublishedCreativeOrgs: () => listPublishedCreativeOrgs(app.prisma!),
      sendEvent: (event: { name: string; data: Record<string, unknown> }) =>
        inngestClient.send(event),
    },
    makeOnFailureHandler(
      {
        functionId: "creative-attribution-dispatch",
        eventDomain: "creative.attribution.dispatch",
        riskCategory: "low",
        alert: false,
        emitEvent: false,
      },
      asyncFailure,
    ) as (arg: unknown) => Promise<void>,
  );

  const creativeAttributionWorker = createCreativeAttributionWorker({
    failure: asyncFailure,
    readEnabledFlag: () => process.env["CREATIVE_ATTRIBUTION_ENABLED"] === "true",
    jobStore,
    conversionStore: bookedValueByCampaignStore,
    resolveMetaCredentials: (orgId) =>
      resolveMetaAdsConnectionCredentials(
        app.prisma!,
        (encrypted) => decryptCredentials(encrypted as string),
        orgId,
      ),
    makeAdsClient: (creds) => new MetaAdsClient(creds),
    logger: app.log,
  });

  // Mira slice 2: taste memory. The daily sweep projects Keep/Pass gestures
  // (the CreativeJob review columns ARE the durable event record) into
  // DeploymentMemory taste buckets; the provider feeds high-confidence buckets
  // back into the trend/hook prompts via the runner's L2 seam. No kill-switch
  // (spec 3.6): no external calls, derived data, reversible writes.
  const deploymentMemoryStoreForTaste = new PrismaDeploymentMemoryStore(app.prisma);
  // Slice-4 weekly self-brief loop (spec 3.7). Kill-switch:
  // MIRA_SELF_BRIEF_ENABLED=true to enable; default off so the deploy is dark
  // until deliberately enabled. Class-E failure contract on both halves: the
  // next weekly run self-heals and a domain event would have zero consumers.
  // The worker resolves the creative deployment itself at floor time and
  // passes it through to the submit closures (no api-direct fallback can leak
  // into a submit: the floor fails closed first).
  const miraSelfBriefDispatch = createMiraSelfBriefDispatch(
    {
      listCreativeOrgs: () => listActiveCreativeOrgs(app.prisma!),
      sendEvent: (event: { name: string; data: Record<string, unknown> }) =>
        inngestClient.send(event),
    },
    makeOnFailureHandler(
      {
        functionId: "mira-self-brief-dispatch",
        eventDomain: "mira.self_brief.dispatch",
        riskCategory: "low",
        alert: false,
        emitEvent: false,
      },
      asyncFailure,
    ) as (arg: unknown) => Promise<void>,
  );

  const selfBriefDeploymentResolver = new PrismaDeploymentResolver(app.prisma as never);
  const miraSelfBriefWorker = createMiraSelfBriefWorker({
    failure: asyncFailure,
    readEnabledFlag: () => process.env["MIRA_SELF_BRIEF_ENABLED"] === "true",
    isMiraEnabled: (orgId: string) =>
      app.orgAgentEnablementStore
        ? isAgentHomeAccessible("mira", orgId, app.orgAgentEnablementStore)
        : Promise.resolve(false),
    resolveCreativeDeployment: async (orgId: string) => {
      try {
        const resolved = await selfBriefDeploymentResolver.resolveByOrgAndSlug(orgId, "creative");
        return resolved
          ? { deploymentId: resolved.deploymentId, skillSlug: resolved.skillSlug }
          : null;
      } catch {
        return null;
      }
    },
    readModel: new PrismaMiraCreativeReadModelReader(app.prisma as never),
    memoryReader: new PrismaDeploymentMemoryStore(app.prisma as never),
    submitCompose:
      options.submitMiraBriefCompose ??
      (() => {
        throw new Error("submitMiraBriefCompose not wired");
      }),
    submitConceptDraft:
      options.submitMiraConceptDraft ??
      (() => {
        throw new Error("submitMiraConceptDraft not wired");
      }),
    warn: (msg: string) => app.log.warn(msg),
  });

  const creativeTasteSweep = createCreativeTasteSweep({
    failure: asyncFailure,
    jobStore,
    memoryStore: deploymentMemoryStoreForTaste,
    logger: app.log,
  });
  const creativeTasteProvider = buildCreativeTasteProvider(deploymentMemoryStoreForTaste);

  await app.register(inngestFastify, {
    client: inngestClient,
    functions: [
      createModeDispatcher(
        makeOnFailureHandler(
          {
            functionId: "creative-mode-dispatcher",
            eventDomain: "creative.dispatch",
            riskCategory: "high",
            alert: true,
          },
          asyncFailure,
        ) as (arg: unknown) => Promise<void>,
      ),
      createCreativeJobRunner(
        jobStore,
        { apiKey, model: creativeModel },
        openaiApiKey ? { openaiApiKey } : undefined,
        assetStorage,
        makeOnFailureHandler(
          {
            functionId: "creative-job-runner",
            eventDomain: "creative.polished",
            riskCategory: "medium",
            alert: false,
          },
          asyncFailure,
        ) as (arg: unknown) => Promise<void>,
        creativeTasteProvider,
      ),
      createUgcJobRunner(
        {
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
          llmConfig: { apiKey, model: creativeModel },
          klingClient,
          heygenClient,
          assetStore,
          // Durable storage for final UGC assets (slice-3 spec 3.3f): the SAME
          // S3 client the polished runner receives, so kept UGC creatives gain
          // a durableAssetUrl and become publishable.
          assetStorage,
        },
        makeOnFailureHandler(
          {
            functionId: "ugc-job-runner",
            riskCategory: "medium",
            alert: false,
            emitEvent: false,
          },
          asyncFailure,
        ) as (arg: unknown) => Promise<void>,
      ),
      createWeeklyAuditCron(
        adOptimizerDeps,
        makeOnFailureHandler(
          {
            functionId: "ad-optimizer-weekly-audit",
            eventDomain: "ad-optimizer.weekly-audit",
            riskCategory: "medium",
            alert: false,
          },
          asyncFailure,
        ) as (arg: unknown) => Promise<void>,
      ),
      createDailyCheckCron(
        adOptimizerDeps,
        makeOnFailureHandler(
          {
            functionId: "ad-optimizer-daily-check",
            riskCategory: "low",
            alert: false,
            emitEvent: false,
          },
          asyncFailure,
        ) as (arg: unknown) => Promise<void>,
      ),
      createDailySignalHealthCron(
        signalHealthDeps,
        makeOnFailureHandler(
          {
            functionId: "ad-optimizer-daily-signal-health",
            eventDomain: "ad-optimizer.signal-health",
            riskCategory: "medium",
            alert: false,
          },
          asyncFailure,
        ) as (arg: unknown) => Promise<void>,
      ),
      dailyPatternDecayCron,
      createMetaTokenRefreshCron(metaTokenRefreshDeps),
      createDlqRetentionPurgeCron(dlqRetentionPurgeDeps),
      createCreativePublishFunction(creativePublishFunctionDeps),
      createReconciliationCron(reconciliationDeps),
      createStripeReconciliationCron(stripeReconciliationDeps),
      createLeadRetryCron(leadRetryDeps),
      createScheduledFollowUpDispatchCron(scheduledFollowUpDispatchDeps),
      createAppointmentReminderDispatchCron(appointmentReminderDispatchDeps),
      createPcdRegistryBackfillCron(pcdRegistryBackfillDeps),
      createLifecycleStalledSweepCron({
        failure: asyncFailure,
        prisma: app.prisma,
        writer: lifecycleWriter,
        history: lifecycleHistory,
        readMode: lifecycleReadMode,
      }),
      rileyOutcomeDispatch,
      rileyOutcomeWorker,
      creativeAttributionDispatch,
      creativeAttributionWorker,
      creativeTasteSweep,
      miraSelfBriefDispatch,
      miraSelfBriefWorker,
    ],
  });

  app.log.info("Inngest serve handler registered at /api/inngest");
}

/**
 * Enumerates distinct organizationIds that have acted Riley recommendations.
 * Used by the Riley outcome-attribution dispatch cron to fan out per-org events.
 * Queries `pendingActionRecord` for rows where sourceAgent="riley" and
 * intent starts with "recommendation." — the same rows that outcome attribution
 * reads back for candidates.
 */
/**
 * Enumerates distinct organizationIds holding an ACTIVE creative deployment.
 * Used by the mira self-brief dispatch to fan out per-org scan events; the
 * per-org worker re-checks enablement, entitlement, and signal floors itself.
 */
async function listActiveCreativeOrgs(prisma: {
  agentDeployment: {
    findMany: (args: {
      where: { skillSlug: string; status: string };
      select: { organizationId: true };
      distinct: ["organizationId"];
    }) => Promise<Array<{ organizationId: string }>>;
  };
}): Promise<string[]> {
  const rows = await prisma.agentDeployment.findMany({
    where: { skillSlug: "creative", status: "active" },
    select: { organizationId: true },
    distinct: ["organizationId"],
  });
  return rows.map((r) => r.organizationId);
}

async function listRileyActiveOrgs(prisma: {
  pendingActionRecord: {
    findMany: (args: {
      where: {
        sourceAgent: string;
        intent: { startsWith: string };
        status: string;
      };
      distinct: ["organizationId"];
      select: { organizationId: true };
    }) => Promise<{ organizationId: string }[]>;
  };
}): Promise<string[]> {
  // Filter to status="acted" so we only dispatch to orgs that actually have
  // attributable rows. Without this, orgs with only queued/shadow_action
  // recommendations get noisy dispatch events that resolve to zero candidates.
  const rows = await prisma.pendingActionRecord.findMany({
    where: {
      sourceAgent: "riley",
      intent: { startsWith: "recommendation." },
      status: "acted",
    },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  return rows.map((r) => r.organizationId);
}

/**
 * Enumerates distinct organizationIds that have at least one published
 * creative (metaCampaignId set by the slice-1 publish path). Used by the
 * creative-attribution dispatch cron to fan out per-org refresh events.
 */
async function listPublishedCreativeOrgs(prisma: {
  creativeJob: {
    findMany: (args: {
      where: { metaCampaignId: { not: null } };
      distinct: ["organizationId"];
      select: { organizationId: true };
    }) => Promise<{ organizationId: string }[]>;
  };
}): Promise<string[]> {
  const rows = await prisma.creativeJob.findMany({
    where: { metaCampaignId: { not: null } },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  return rows.map((r) => r.organizationId);
}
