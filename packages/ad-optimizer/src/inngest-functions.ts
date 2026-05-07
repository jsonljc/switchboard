// packages/ad-optimizer/src/inngest-functions.ts
import { Inngest } from "inngest";

const inngestClient = new Inngest({ id: "switchboard" });
import { AuditRunner } from "./audit-runner.js";
import type { AdsClientInterface, AuditConfig } from "./audit-runner.js";
import type { CrmDataProvider, CampaignInsightsProvider } from "@switchboard/schemas";
import type { SignalHealthReport } from "./signal-health-checker.js";

interface DeploymentInfo {
  id: string;
  organizationId: string;
  inputConfig: {
    monthlyBudget?: number;
    targetCPA?: number;
    targetROAS?: number;
  };
}

interface DeploymentCredentials {
  accessToken: string;
  accountId: string;
}

export interface CronDependencies {
  listActiveDeployments: () => Promise<DeploymentInfo[]>;
  getDeploymentCredentials: (deploymentId: string) => Promise<DeploymentCredentials | null>;
  createAdsClient: (creds: DeploymentCredentials) => AdsClientInterface;
  createCrmProvider: (deploymentId: string) => CrmDataProvider;
  createInsightsProvider: (adsClient: AdsClientInterface) => CampaignInsightsProvider;
  saveAuditReport: (deploymentId: string, report: unknown) => Promise<void>;
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

export async function executeWeeklyAudit(step: StepTools, deps: CronDependencies): Promise<void> {
  const deployments = await step.run("list-deployments", () => deps.listActiveDeployments());
  const dateRanges = getWeeklyDateRanges();

  for (const deployment of deployments) {
    const creds = await step.run(`creds-${deployment.id}`, () =>
      deps.getDeploymentCredentials(deployment.id),
    );
    if (!creds) continue;

    await step.run(`audit-${deployment.id}`, async () => {
      const adsClient = deps.createAdsClient(creds);
      const config: AuditConfig = {
        accountId: creds.accountId,
        orgId: deployment.organizationId,
        targetCPA: deployment.inputConfig.targetCPA ?? 100,
        targetROAS: deployment.inputConfig.targetROAS ?? 3.0,
        mediaBenchmarks: {
          inlineLinkClickCtr: 2.0,
          landingPageViewRate: 0.85,
          clickToLeadRate: 0.05,
        },
      };
      const runner = new AuditRunner({
        adsClient,
        crmDataProvider: deps.createCrmProvider(deployment.id),
        insightsProvider: deps.createInsightsProvider(adsClient),
        config,
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

export function createWeeklyAuditCron(deps: CronDependencies) {
  return inngestClient.createFunction(
    {
      id: "ad-optimizer-weekly-audit",
      name: "Ad Optimizer Weekly Audit",
      retries: 2,
      triggers: [{ cron: "0 9 * * 1" }],
    },
    async ({ step }) => {
      await executeWeeklyAudit(step as unknown as StepTools, deps);
    },
  );
}

export function createDailyCheckCron(deps: CronDependencies) {
  return inngestClient.createFunction(
    {
      id: "ad-optimizer-daily-check",
      name: "Ad Optimizer Daily Check",
      retries: 2,
      triggers: [{ cron: "0 8 * * *" }],
    },
    async ({ step }) => {
      await executeDailyCheck(step as unknown as StepTools, deps);
    },
  );
}

// ── Signal Health Daily Cron ──

interface SignalHealthCheckerLike {
  getSignalHealthReport(pixelId: string): Promise<SignalHealthReport>;
}

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

export function createDailySignalHealthCron(deps: SignalHealthCronDependencies) {
  return inngestClient.createFunction(
    {
      id: "ad-optimizer-daily-signal-health",
      name: "Ad Optimizer Daily Signal Health",
      retries: 2,
      // Runs at 07:00 UTC, ahead of the 08:00 daily check so signal failures
      // are visible before the rest of the daily pipeline runs.
      triggers: [{ cron: "0 7 * * *" }],
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
