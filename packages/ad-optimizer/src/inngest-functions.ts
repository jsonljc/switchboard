// packages/core/src/ad-optimizer/inngest-functions.ts
import { Inngest } from "inngest";

const inngestClient = new Inngest({ id: "switchboard" });
import { AuditRunner } from "./audit-runner.js";
import type { AdsClientInterface, AuditConfig } from "./audit-runner.js";
import type { CrmDataProvider, CampaignInsightsProvider } from "@switchboard/schemas";

interface DeploymentInfo {
  id: string;
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
        orgId: "TODO", // TODO: Extract from deployment when deployment model is updated
        targetCPA: deployment.inputConfig.targetCPA ?? 100,
        targetROAS: deployment.inputConfig.targetROAS ?? 3.0,
        mediaBenchmarks: { ctr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 },
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
