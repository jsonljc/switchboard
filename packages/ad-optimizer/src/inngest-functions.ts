// packages/ad-optimizer/src/inngest-functions.ts
import { Inngest, type InngestFunction } from "inngest";

const inngestClient = new Inngest({ id: "switchboard" });
import { AuditRunner } from "./audit-runner.js";
import type {
  AdsClientInterface,
  AuditConfig,
  BookedValueByCampaignProvider,
} from "./audit-runner.js";
import type { CrmDataProvider, CampaignInsightsProvider } from "@switchboard/schemas";
import type { SignalHealthReport, SignalHealthReportProvider } from "./signal-health-checker.js";
import type { RecommendationEmitter } from "./recommendation-sink.js";
import type { CoverageReport } from "./onboarding/coverage-validator.js";
import type { RecommendationHandoffSubmitter } from "./recommendation-handoff-dispatch.js";
import type { RileyPauseSubmitter } from "./riley-pause-dispatch.js";
import type { RileyBudgetSubmitter } from "./riley-budget-dispatch.js";

interface DeploymentInfo {
  id: string;
  organizationId: string;
  inputConfig: {
    monthlyBudget?: number;
    targetCPA?: number;
    targetROAS?: number;
    targetCostPerBooked?: number;
    /** Phase-A Gate 1: Meta `actions` action_type for the breach denominator (e.g. "lead"). */
    conversionActionType?: string;
    /** Attribution windows pinned for `conversionActionType` (e.g. ["7d_click"]). */
    attributionWindows?: string[];
  };
  /** Phase-C per-org dispatch flag (governanceSettings.pauseSelfExecutionEnabled,
   * mapped by apps/api). Absent/false = the pause submitter is never threaded
   * into this deployment's AuditRunner. Default OFF; flips only via the audited
   * scripts/riley-pause-flag.ts toggle. */
  pauseSelfExecutionEnabled?: boolean;
}

interface DeploymentCredentials {
  accessToken: string;
  accountId: string;
}

type SignalHealthCheckerLike = SignalHealthReportProvider;

export interface CronDependencies {
  listActiveDeployments: () => Promise<DeploymentInfo[]>;
  getDeploymentCredentials: (deploymentId: string) => Promise<DeploymentCredentials | null>;
  createAdsClient: (creds: DeploymentCredentials) => AdsClientInterface;
  createCrmProvider: (deploymentId: string) => CrmDataProvider;
  createInsightsProvider: (adsClient: AdsClientInterface) => CampaignInsightsProvider;
  saveAuditReport: (deploymentId: string, report: unknown) => Promise<void>;
  /**
   * Optional. When both this and `createSignalHealthChecker` are provided,
   * the weekly audit pulls a signal-health report at the start of each
   * deployment audit and either short-circuits diagnostics (red score) or
   * appends `fix_signal_health` recs (yellow score). Optional for back-compat
   * with callers that have not been re-wired yet.
   */
  getDeploymentPixelId?: (deploymentId: string) => Promise<string | null>;
  createSignalHealthChecker?: (creds: DeploymentCredentials) => SignalHealthCheckerLike;
  /**
   * Optional. When provided, the weekly audit's AuditRunner forwards every
   * scored recommendation candidate through this emitter for routing into the
   * v1 pipeline (queue / shadow_action / dropped). When absent, the audit runs
   * as a pure analyzer — back-compatible with callers that have not yet been
   * re-wired. Production wiring lives in apps/api/src/bootstrap/inngest.ts and
   * closes over both the RecommendationStore and the
   * PrismaRecommendationEmissionMirror so each emission writes a Recommendation
   * row + a paired WorkTrace row atomically (Wave B PR-1 substrate).
   */
  recommendationEmitter?: RecommendationEmitter;
  /**
   * Optional Gate 0. When provided, the weekly audit's AuditRunner gets a
   * coverage validator and abstains (no recommendations, one explanatory insight)
   * if tracked-source coverage is below the sufficiency floor. Default unset ⇒ no
   * gate (production behavior unchanged until a real validator is wired in
   * apps/api). NOTE: the real CoverageValidator needs `listCampaigns` + an intake
   * store, neither of which is available on the current cron ads client — wiring a
   * production validator is a follow-up.
   */
  createCoverageValidator?: (
    deploymentId: string,
    creds: DeploymentCredentials,
  ) => { validate(q: { orgId: string; accountId: string }): Promise<CoverageReport> };
  /**
   * Optional. Per-campaign booked-VALUE (cents) provider for the weekly audit's
   * trueROAS reporting (`campaignEconomics`). A singleton keyed on orgId — no
   * per-deployment creds. Wired in apps/api/src/bootstrap/inngest.ts with
   * PrismaConversionRecordStore. Absent ⇒ trueROAS reported null (graceful).
   */
  bookedValueByCampaignProvider?: BookedValueByCampaignProvider;
  /**
   * Optional. When provided, each EMITTED creative recommendation that clears the
   * handoff abstention is routed to a governed Mira draft (parking for mandatory
   * human approval) through this bootstrap-injected submit callback. Wired in
   * apps/api/src/bootstrap/inngest.ts; ad-optimizer (Layer 2) never imports
   * PlatformIngress. Absent ⇒ the weekly audit produces no Riley -> agent handoffs.
   */
  recommendationHandoffSubmitter?: RecommendationHandoffSubmitter;
  /**
   * Optional (Phase-C). Routes the arbitration-PRIMARY pause to the governed
   * pause intent (parking for mandatory approval). Wired by apps/api ONLY under
   * the RILEY_PAUSE_SELF_EXECUTION_ENABLED env kill switch; threaded into each
   * org's AuditRunner ONLY when that deployment's
   * governanceSettings.pauseSelfExecutionEnabled is true (capability-passing as
   * enforcement; both default OFF). Absent = the weekly audit self-submits no
   * pauses. ad-optimizer (Layer 2) never imports PlatformIngress.
   */
  rileyPauseSubmitter?: RileyPauseSubmitter;
  /**
   * Spec-1B 1B-1.6: the reallocate self-submission initiator, present only under the
   * RILEY_REALLOCATE_SELF_EXECUTION_ENABLED env kill switch (default OFF). Unlike pause, v1 gates at
   * the env level only (no per-deployment flag); when present it reaches every deployment's
   * AuditRunner, and every proposed reallocation still parks for mandatory human approval. Absent =
   * the weekly audit proposes no reallocations.
   */
  rileyBudgetSubmitter?: RileyBudgetSubmitter;
  /**
   * Optional (slice 4c). Latest operator operational-state confirmation per
   * org, feeding RevenueState.businessContextFreshness in the weekly audit.
   * Wired in apps/api/src/bootstrap/inngest.ts with
   * PrismaOperationalStateStore.getLatest; ad-optimizer (Layer 2) never
   * imports the store. Absent ⇒ freshness stays "unknown" (back-compat).
   */
  getLatestOperationalState?: (organizationId: string) => Promise<{ confirmedAt: Date } | null>;
}

interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  sendEvent: (
    stepId: string,
    event: { name: string; data: Record<string, unknown> },
  ) => Promise<void>;
}

function getWeeklyDateRanges() {
  const now = new Date();
  const until = new Date(now);
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - 6);
  const prevUntil = new Date(since);
  prevUntil.setDate(prevUntil.getDate() - 1);
  const prevSince = new Date(prevUntil);
  prevSince.setDate(prevSince.getDate() - 6);
  return {
    dateRange: { since: fmt(since), until: fmt(until) },
    previousDateRange: { since: fmt(prevSince), until: fmt(prevUntil) },
  };
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0] ?? "";
}

// TODO(scale): Both weekly-audit and daily-signal-health crons loop
// deployments serially. Each deployment runs ~4–6 Graph API calls inside a
// single Inngest step, so wall time scales O(N). With the real
// MetaCampaignInsightsProvider wired in, cost is now per-campaign (not just
// per-deployment): each campaign adds ~4 serialized Graph calls (learning
// inputs + daily breach window) behind the 60s RATE_LIMIT_MS, so total wall
// time ≈ N_deployments × N_campaigns × 60s. Per-source attribution adds 2 more
// ACCOUNT-level Graph calls per weekly deployment (the /adsets config edge +
// account ad-set insights), i.e. +~60s/deployment — flat, not per-campaign.
// Acceptable at current tenancy; revisit (parallelize via Promise.all of
// step.run) if launch tenancy crosses ~25 deployments or avg campaign count > 5.

export async function executeWeeklyAudit(step: StepTools, deps: CronDependencies): Promise<void> {
  const deployments = await step.run("list-deployments", () => deps.listActiveDeployments());
  const dateRanges = getWeeklyDateRanges();

  for (const deployment of deployments) {
    const creds = await step.run(`creds-${deployment.id}`, () =>
      deps.getDeploymentCredentials(deployment.id),
    );
    if (!creds) continue;

    // Pixel id resolution is its own Inngest step so it gets persisted +
    // retried independently from the audit itself.
    const pixelId = deps.getDeploymentPixelId
      ? await step.run(`pixel-${deployment.id}`, () => deps.getDeploymentPixelId!(deployment.id))
      : null;

    await step.run(`audit-${deployment.id}`, async () => {
      const adsClient = deps.createAdsClient(creds);
      // NOTE (PR2): read as a strict number. Sibling inputConfig fields (targetCPA/
      // targetROAS) are stored as strings by the seed/wizard; a future producer that
      // writes targetCostPerBooked as a string would be silently dropped here (→ Tier 2
      // CPL, never booked_cac). When a real producer lands (wizard), route it through
      // resolveAdOptimizerConfig/AdOptimizerConfigSchema to coerce string→number.
      const cpb = deployment.inputConfig.targetCostPerBooked;
      // Phase-A Gate 1: optional conversions-denominator config. Default unset =
      // back-compat (aggregate `conversions`). Guarded like targetCostPerBooked so a
      // missing/empty producer value never silently changes the denominator.
      const conversionActionType = deployment.inputConfig.conversionActionType;
      const attributionWindows = deployment.inputConfig.attributionWindows;
      const config: AuditConfig = {
        accountId: creds.accountId,
        orgId: deployment.organizationId,
        targetCPA: deployment.inputConfig.targetCPA ?? 100,
        targetROAS: deployment.inputConfig.targetROAS ?? 3.0,
        ...(typeof cpb === "number" && cpb > 0 ? { targetCostPerBooked: cpb } : {}),
        ...(typeof conversionActionType === "string" && conversionActionType
          ? { conversionActionType }
          : {}),
        ...(Array.isArray(attributionWindows) && attributionWindows.length > 0
          ? { attributionWindows }
          : {}),
        mediaBenchmarks: {
          inlineLinkClickCtr: 2.0,
          landingPageViewRate: 0.85,
          clickToLeadRate: 0.05,
        },
        ...(pixelId ? { pixelId } : {}),
      };
      const signalHealthChecker =
        pixelId && deps.createSignalHealthChecker
          ? deps.createSignalHealthChecker(creds)
          : undefined;
      // Gate 0 (optional, back-compat). Unset ⇒ no coverage gate. A production
      // validator is a follow-up (needs listCampaigns + intake store).
      const coverageValidator = deps.createCoverageValidator
        ? deps.createCoverageValidator(deployment.id, creds)
        : undefined;
      const runner = new AuditRunner({
        adsClient,
        crmDataProvider: deps.createCrmProvider(deployment.id),
        insightsProvider: deps.createInsightsProvider(adsClient),
        config,
        // Per-source spend attribution: feed real account ad-set destination data so
        // computeSpendBySource attributes spend (vs the synthetic lead-share fallback).
        // Resilient: an ad-set fetch failure degrades to null (→ lead-share → honest abstain),
        // never a crashed weekly run. Read-only; advisory path unchanged.
        ...(adsClient.getAccountAdSetLearningInputs
          ? {
              getAdSetInsights: async ({
                dateRange,
              }: {
                dateRange: { since: string; until: string };
                fields: string[];
              }) => {
                try {
                  return await adsClient.getAccountAdSetLearningInputs!(dateRange);
                } catch (err) {
                  // Error-level: a swallowed fetch failure must be visible to ops/alerting.
                  // The audit still completes (the per-campaign analysis is independent), and
                  // the source-reallocation rec degrades to honest abstain (lead-share). A
                  // report-level "ad-set data unavailable" insight is a deferred enhancement;
                  // re-throwing instead would re-run every rate-limited Graph call on a blip.
                  console.error(
                    `[ad-optimizer] ad-set attribution fetch failed for deployment=${deployment.id}; ` +
                      `falling back to lead-share (no source reallocation this run): ${String(err)}`,
                  );
                  return null;
                }
              },
            }
          : {}),
        ...(signalHealthChecker ? { signalHealthChecker } : {}),
        ...(coverageValidator ? { coverageValidator } : {}),
        ...(deps.bookedValueByCampaignProvider
          ? { bookedValueByCampaignProvider: deps.bookedValueByCampaignProvider }
          : {}),
        ...(deps.recommendationEmitter
          ? {
              recommendationEmitter: deps.recommendationEmitter,
              recommendationEmissionContext: {
                cronId: "ad-optimizer-weekly-audit",
                deploymentId: deployment.id,
              },
            }
          : {}),
        ...(deps.recommendationHandoffSubmitter
          ? { recommendationHandoffSubmitter: deps.recommendationHandoffSubmitter }
          : {}),
        // Phase-C: capability-passing as enforcement. The pause submitter reaches
        // a deployment's runner ONLY when its per-org flag is on (and the dep
        // itself exists only under the env kill switch). Both default OFF.
        ...(deps.rileyPauseSubmitter && deployment.pauseSelfExecutionEnabled
          ? { rileyPauseSubmitter: deps.rileyPauseSubmitter }
          : {}),
        // Spec-1B 1B-1.6: reallocate self-submission. v1 is env-gated only (the dep exists solely
        // under RILEY_REALLOCATE_SELF_EXECUTION_ENABLED); no per-deployment flag, so a wired dep
        // reaches every org's runner. Every proposed move still parks for mandatory approval.
        ...(deps.rileyBudgetSubmitter ? { rileyBudgetSubmitter: deps.rileyBudgetSubmitter } : {}),
        ...(deps.getLatestOperationalState
          ? { operationalStateProvider: { getLatest: deps.getLatestOperationalState } }
          : {}),
      });
      const report = await runner.run(dateRanges);
      await deps.saveAuditReport(deployment.id, report);
    });
  }
}

export async function executeDailyCheck(step: StepTools, deps: CronDependencies): Promise<void> {
  const deployments = await step.run("list-deployments", () => deps.listActiveDeployments());

  for (const deployment of deployments) {
    const creds = await step.run(`creds-${deployment.id}`, () =>
      deps.getDeploymentCredentials(deployment.id),
    );
    if (!creds) continue;

    await step.run(`check-${deployment.id}`, async () => {
      const adsClient = deps.createAdsClient(creds);
      await adsClient.getAccountSummary();
    });
  }
}

export function createWeeklyAuditCron(
  deps: CronDependencies,
  onFailure?: (arg: unknown) => Promise<void>,
): InngestFunction.Any {
  return inngestClient.createFunction(
    {
      id: "ad-optimizer-weekly-audit",
      name: "Ad Optimizer Weekly Audit",
      retries: 2,
      triggers: [{ cron: "0 9 * * 1" }],
      ...(onFailure ? { onFailure } : {}),
    },
    async ({ step }) => {
      await executeWeeklyAudit(step as unknown as StepTools, deps);
    },
  );
}

export function createDailyCheckCron(
  deps: CronDependencies,
  onFailure?: (arg: unknown) => Promise<void>,
): InngestFunction.Any {
  return inngestClient.createFunction(
    {
      id: "ad-optimizer-daily-check",
      name: "Ad Optimizer Daily Check",
      retries: 2,
      triggers: [{ cron: "0 8 * * *" }],
      ...(onFailure ? { onFailure } : {}),
    },
    async ({ step }) => {
      await executeDailyCheck(step as unknown as StepTools, deps);
    },
  );
}

// ── Signal Health Daily Cron ──

export interface SignalHealthCronDependencies {
  listActiveDeployments: () => Promise<DeploymentInfo[]>;
  getDeploymentCredentials: (deploymentId: string) => Promise<DeploymentCredentials | null>;
  getDeploymentPixelId: (deploymentId: string) => Promise<string | null>;
  createSignalHealthChecker: (creds: DeploymentCredentials) => SignalHealthCheckerLike;
  saveSignalHealthReport: (deploymentId: string, report: SignalHealthReport) => Promise<void>;
}

export async function executeDailySignalHealthCheck(
  step: StepTools,
  deps: SignalHealthCronDependencies,
): Promise<void> {
  const deployments = await step.run("list-deployments", () => deps.listActiveDeployments());

  for (const deployment of deployments) {
    const creds = await step.run(`creds-${deployment.id}`, () =>
      deps.getDeploymentCredentials(deployment.id),
    );
    if (!creds) continue;

    const pixelId = await step.run(`pixel-${deployment.id}`, () =>
      deps.getDeploymentPixelId(deployment.id),
    );
    if (!pixelId) continue;

    await step.run(`signal-health-${deployment.id}`, async () => {
      const checker = deps.createSignalHealthChecker(creds);
      const report = await checker.getSignalHealthReport(pixelId);
      if (report.score === "red") {
        const breachList = report.breaches
          .filter((b) => b.severity === "critical")
          .map((b) => b.signal)
          .join(", ");
        console.warn(
          `[ad-optimizer] signal-health RED for deployment=${deployment.id} ` +
            `pixel=${pixelId}: ${breachList || "critical breach"}`,
        );
      }
      await deps.saveSignalHealthReport(deployment.id, report);
    });
  }
}

export function createDailySignalHealthCron(
  deps: SignalHealthCronDependencies,
  onFailure?: (arg: unknown) => Promise<void>,
): InngestFunction.Any {
  return inngestClient.createFunction(
    {
      id: "ad-optimizer-daily-signal-health",
      name: "Ad Optimizer Daily Signal Health",
      retries: 2,
      // Runs at 07:00 UTC, ahead of the 08:00 daily check so signal failures
      // are visible before the rest of the daily pipeline runs.
      triggers: [{ cron: "0 7 * * *" }],
      ...(onFailure ? { onFailure } : {}),
    },
    async ({ step }) => {
      await executeDailySignalHealthCheck(step as unknown as StepTools, deps);
    },
  );
}

// Thin Dispatcher Functions — emit one event per deployment

interface DispatchDependencies {
  listActiveDeployments: () => Promise<Array<{ id: string }>>;
}

interface InngestLike {
  createFunction(config: { id: string; triggers: unknown[] }, handler: unknown): unknown;
}

export function createWeeklyAuditDispatcher(
  inngestClient: InngestLike,
  deps: DispatchDependencies,
) {
  return inngestClient.createFunction(
    { id: "ad-optimizer-weekly-dispatch", triggers: [{ cron: "0 6 * * 1" }] },
    async ({ step }: { step: StepTools }) => {
      const deployments = await step.run("list-deployments", () => deps.listActiveDeployments());

      for (const deployment of deployments) {
        await step.sendEvent(`dispatch-${deployment.id}`, {
          name: "skill-runtime/batch.requested",
          data: {
            deploymentId: deployment.id,
            skillSlug: "ad-optimizer",
            trigger: "weekly_audit",
            scheduleName: "ad-optimizer-weekly",
          },
        });
      }

      return { dispatched: deployments.length };
    },
  );
}

export function createDailyCheckDispatcher(inngestClient: InngestLike, deps: DispatchDependencies) {
  return inngestClient.createFunction(
    { id: "ad-optimizer-daily-dispatch", triggers: [{ cron: "0 8 * * *" }] },
    async ({ step }: { step: StepTools }) => {
      const deployments = await step.run("list-deployments", () => deps.listActiveDeployments());

      for (const deployment of deployments) {
        await step.sendEvent(`dispatch-${deployment.id}`, {
          name: "skill-runtime/batch.requested",
          data: {
            deploymentId: deployment.id,
            skillSlug: "ad-optimizer",
            trigger: "daily_check",
            scheduleName: "ad-optimizer-daily",
          },
        });
      }

      return { dispatched: deployments.length };
    },
  );
}

// ── Riley Outcome Attribution Dispatch Cron ──

export interface RileyOutcomeAttributionDispatchDeps {
  listRileyOrgs: () => Promise<string[]>;
  /** Bound to inngestClient.send in apps/api. */
  sendEvent: (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;
}

interface RileyDispatchStepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export async function executeRileyOutcomeAttributionDispatch(
  step: RileyDispatchStepTools,
  deps: RileyOutcomeAttributionDispatchDeps,
): Promise<{ dispatched: number }> {
  const orgs = await step.run("list-riley-orgs", () => deps.listRileyOrgs());
  for (const orgId of orgs) {
    await step.run(`emit-${orgId}`, async () => {
      await deps.sendEvent({ name: "riley.outcome.attribute", data: { orgId } });
    });
  }
  return { dispatched: orgs.length };
}

export function createRileyOutcomeAttributionDispatch(
  deps: RileyOutcomeAttributionDispatchDeps,
  onFailure?: (arg: unknown) => Promise<void>,
): InngestFunction.Any {
  return inngestClient.createFunction(
    {
      id: "riley-outcome-attribution-dispatch",
      name: "Riley Outcome Attribution Dispatch",
      retries: 2,
      triggers: [{ cron: "0 7 * * *" }],
      ...(onFailure ? { onFailure } : {}),
    },
    async ({ step }) => {
      return executeRileyOutcomeAttributionDispatch(
        step as unknown as RileyDispatchStepTools,
        deps,
      );
    },
  );
}
