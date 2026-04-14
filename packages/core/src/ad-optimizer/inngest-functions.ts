// packages/core/src/ad-optimizer/inngest-functions.ts
import { inngestClient } from "../creative-pipeline/inngest-client.js";
import { AuditRunner } from "./audit-runner.js";
import type { AdsClientInterface, CrmDataProvider, AuditConfig } from "./audit-runner.js";

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
  saveAuditReport: (deploymentId: string, report: unknown) => Promise<void>;
}

interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
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
  return d.toISOString().split("T")[0];
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
      const config: AuditConfig = {
        accountId: creds.accountId,
        targetCPA: deployment.inputConfig.targetCPA ?? 100,
        targetROAS: deployment.inputConfig.targetROAS ?? 3.0,
      };
      const runner = new AuditRunner({
        adsClient: deps.createAdsClient(creds),
        crmDataProvider: deps.createCrmProvider(deployment.id),
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
      const _summary = await adsClient.getAccountSummary();
    });
  }
}

export function createWeeklyAuditCron(deps: CronDependencies) {
  return inngestClient.createFunction(
    { id: "ad-optimizer-weekly-audit", name: "Ad Optimizer Weekly Audit", retries: 2 },
    { cron: "0 9 * * 1" },
    async ({ step }) => {
      await executeWeeklyAudit(step, deps);
    },
  );
}

export function createDailyCheckCron(deps: CronDependencies) {
  return inngestClient.createFunction(
    { id: "ad-optimizer-daily-check", name: "Ad Optimizer Daily Check", retries: 2 },
    { cron: "0 8 * * *" },
    async ({ step }) => {
      await executeDailyCheck(step, deps);
    },
  );
}
