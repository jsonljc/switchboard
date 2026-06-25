import type { WorkflowHandler } from "@switchboard/core/platform";
import {
  buildRileyResetBudgetExecutionWorkflow,
  type RileyResetBudgetCredsResult,
} from "../services/workflows/riley-reset-budget-execution-workflow.js";

/**
 * Bootstrap wiring for the automated reset-to-prior rollback executor. Mirrors
 * buildRileyBudgetExecutorHandler's credential resolution (org isolation lives INSIDE the resolver:
 * the deployment row's organizationId must equal the work unit's before any decrypt, a missing
 * deployment maps to org_mismatch), but is otherwise minimal: the reset has no approval lifecycle,
 * no durable lease, and no recommendation to stamp. It resolves credentials from the FROZEN
 * deploymentId in the work unit parameters (the reset's own deployment context is platform-direct).
 */
export async function buildRileyResetBudgetExecutorHandler(
  prismaClient: unknown,
): Promise<{ intent: string; handler: WorkflowHandler }> {
  const { RILEY_RESET_PRIOR_BUDGET_INTENT } =
    await import("../services/workflows/riley-reset-budget-submit-request.js");
  const { PrismaDeploymentConnectionStore, PrismaDeploymentStore, decryptCredentials } =
    await import("@switchboard/db");
  const { MetaAdsClient } = await import("@switchboard/ad-optimizer");

  const connectionStore = new PrismaDeploymentConnectionStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentConnectionStore>[0],
  );
  const deploymentStore = new PrismaDeploymentStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentStore>[0],
  );

  const handler = buildRileyResetBudgetExecutionWorkflow({
    getDeploymentCredentials: async (
      organizationId,
      deploymentId,
    ): Promise<RileyResetBudgetCredsResult> => {
      const deployment = await deploymentStore.findById(deploymentId);
      if (!deployment || deployment.organizationId !== organizationId) {
        return { kind: "org_mismatch" as const };
      }
      const conn = await connectionStore.findByDeploymentAndType(deploymentId, "meta-ads");
      if (!conn) return { kind: "none" as const };
      try {
        const creds = decryptCredentials(conn.credentials);
        return {
          kind: "ok" as const,
          credentials: {
            accessToken: creds.accessToken as string,
            accountId: creds.accountId as string,
          },
        };
      } catch {
        return { kind: "none" as const };
      }
    },
    createAdsClient: (creds) => new MetaAdsClient(creds),
  });

  return { intent: RILEY_RESET_PRIOR_BUDGET_INTENT, handler };
}
