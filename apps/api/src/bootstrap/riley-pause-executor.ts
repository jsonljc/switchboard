import type { WorkflowHandler } from "@switchboard/core/platform";
import {
  buildRileyPauseExecutionWorkflow,
  type RileyPauseCredsResult,
} from "../services/workflows/riley-pause-execution-workflow.js";

/**
 * Bootstrap wiring for the Phase-C pause executor (extracted from
 * contained-workflows.ts to keep that file under the architecture line gate).
 *
 * Org isolation lives INSIDE the credential resolver: the deployment row's
 * organizationId must equal the work unit's before any credential decrypts
 * (defense in depth behind the org-scoped top-level resolver). A missing
 * deployment row maps to org_mismatch too: a vanished deployment must not pause
 * anything, and the loud failure is the safe direction.
 */
export async function buildRileyPauseExecutorHandler(prismaClient: unknown): Promise<{
  intent: string;
  handler: WorkflowHandler;
}> {
  const { RILEY_PAUSE_INTENT } =
    await import("../services/workflows/riley-pause-submit-request.js");
  const { PrismaDeploymentConnectionStore, PrismaDeploymentStore, decryptCredentials } =
    await import("@switchboard/db");
  const { MetaAdsClient } = await import("@switchboard/ad-optimizer");

  const connectionStore = new PrismaDeploymentConnectionStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentConnectionStore>[0],
  );
  const deploymentStore = new PrismaDeploymentStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentStore>[0],
  );

  const handler = buildRileyPauseExecutionWorkflow({
    getDeploymentCredentials: async (
      organizationId,
      deploymentId,
    ): Promise<RileyPauseCredsResult> => {
      const deployment = await deploymentStore.findById(deploymentId);
      if (!deployment || deployment.organizationId !== organizationId) {
        return { kind: "org_mismatch" as const };
      }
      const conn = await connectionStore.findByDeploymentAndType(deploymentId, "meta-ads");
      if (!conn) return { kind: "none" as const };
      const creds = decryptCredentials(conn.credentials);
      return {
        kind: "ok" as const,
        credentials: {
          accessToken: creds.accessToken as string,
          accountId: creds.accountId as string,
        },
      };
    },
    createAdsClient: (creds) => new MetaAdsClient(creds),
  });

  return { intent: RILEY_PAUSE_INTENT, handler };
}
