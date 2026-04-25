import { Inngest } from "inngest";

const inngestClient = new Inngest({ id: "switchboard" });

interface ReconciliationReport {
  organizationId: string;
  overallStatus: string;
  checks: Array<{ name: string; status: string }>;
}

interface OrgRecord {
  id: string;
  name: string;
}

export interface ReconciliationCronDeps {
  listActiveOrganizations: () => Promise<OrgRecord[]>;
  runReconciliation: (
    orgId: string,
    dateRange: { from: Date; to: Date },
  ) => Promise<ReconciliationReport>;
  logActivity?: (orgId: string, action: string, detail: Record<string, unknown>) => Promise<void>;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export async function executeReconciliation(
  step: StepTools,
  deps: ReconciliationCronDeps,
): Promise<{ processed: number; healthy: number; degraded: number; failing: number }> {
  const orgs = await step.run("list-active-orgs", () => deps.listActiveOrganizations());

  let healthy = 0;
  let degraded = 0;
  let failing = 0;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(yesterday);
  weekAgo.setDate(weekAgo.getDate() - 6);

  for (const org of orgs) {
    await step.run(`reconcile-${org.id}`, async () => {
      try {
        const report = await deps.runReconciliation(org.id, { from: weekAgo, to: yesterday });

        if (report.overallStatus === "healthy") healthy++;
        else if (report.overallStatus === "degraded") degraded++;
        else failing++;

        if (deps.logActivity) {
          await deps.logActivity(org.id, "reconciliation.completed", {
            status: report.overallStatus,
            checks: report.checks.length,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[reconciliation] Failed for org ${org.id}: ${msg}`);
        failing++;
      }
    });
  }

  return { processed: orgs.length, healthy, degraded, failing };
}

export function createReconciliationCron(deps: ReconciliationCronDeps) {
  return inngestClient.createFunction(
    {
      id: "reconciliation-daily",
      name: "Daily Reconciliation",
      retries: 2,
      triggers: [{ cron: "0 2 * * *" }],
    },
    async ({ step }) => {
      return executeReconciliation(step as unknown as StepTools, deps);
    },
  );
}
