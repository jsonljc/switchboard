// packages/ad-optimizer/src/inngest-functions.ts
import { Inngest } from "inngest";

const inngestClient = new Inngest({ id: "switchboard" });
import { AuditRunner } from "./audit-runner.js";
import type { AdsClientInterface, AuditConfig } from "./audit-runner.js";
import type { CrmDataProvider, CampaignInsightsProvider } from "@switchboard/schemas";
import type { SignalHealthReport, SignalHealthReportProvider } from "./signal-health-checker.js";
import type { RecommendationEmitter } from "./recommendation-sink.js";

interface DeploymentInfo {
  id: string;
  organizationId: string;
  inputConfig: {
    monthlyBudget?: number;
    targetCPA?: number;
    targetROAS?: number;
    targetCostPerBooked?: number;
  };
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
// time ≈ N_deployments × N_campaigns × 60s. Acceptable at current tenancy;
// revisit (parallelize via Promise.all of step.run) if launch
// tenancy crosses ~25 deployments or average campaign count > 5.

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
      const config: AuditConfig = {
        accountId: creds.accountId,
        orgId: deployment.organizationId,
        targetCPA: deployment.inputConfig.targetCPA ?? 100,
        targetROAS: deployment.inputConfig.targetROAS ?? 3.0,
        ...(typeof cpb === "number" && cpb > 0 ? { targetCostPerBooked: cpb } : {}),
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
      const runner = new AuditRunner({
        adsClient,
        crmDataProvider: deps.createCrmProvider(deployment.id),
        insightsProvider: deps.createInsightsProvider(adsClient),
        config,
        ...(signalHealthChecker ? { signalHealthChecker } : {}),
        ...(deps.recommendationEmitter
          ? {
              recommendationEmitter: deps.recommendationEmitter,
              recommendationEmissionContext: {
                cronId: "ad-optimizer-weekly-audit",
                deploymentId: deployment.id,
              },
            }
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
) {
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
) {
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
) {
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
) {
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
