import type { WorkflowHandler } from "@switchboard/core/platform";
import type { MarkActedByExecutionResult } from "@switchboard/db";
import {
  buildRileyPauseExecutionWorkflow,
  RILEY_PAUSE_EXECUTION_RESOLVED_BY,
  type RileyPauseCredsResult,
  type RileyPauseExecutionDeps,
} from "../services/workflows/riley-pause-execution-workflow.js";

/**
 * Slice 4f: the executor-facing transition dep over the db store. Extracted
 * and exported so the sentinel + arg mapping are unit-testable without
 * network (the real MetaAdsClient blocks reaching the success leg in
 * bootstrap-level tests). The type-only db import above is erased at build
 * time, so it cannot defeat this module's lazy dynamic-import intent.
 */
export function buildMarkRecommendationActed(store: {
  markActedByExecution(args: {
    id: string;
    organizationId: string;
    executableWorkUnitId: string;
    resolvedBy: string;
    executedAt: Date;
  }): Promise<MarkActedByExecutionResult>;
}): RileyPauseExecutionDeps["markRecommendationActed"] {
  return (args) =>
    store.markActedByExecution({
      id: args.recommendationId,
      organizationId: args.organizationId,
      executableWorkUnitId: args.executableWorkUnitId,
      resolvedBy: RILEY_PAUSE_EXECUTION_RESOLVED_BY,
      executedAt: args.executedAt,
    });
}

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
  const {
    PrismaDeploymentConnectionStore,
    PrismaDeploymentStore,
    PrismaRecommendationStore,
    decryptCredentials,
  } = await import("@switchboard/db");
  const { MetaAdsClient } = await import("@switchboard/ad-optimizer");

  const connectionStore = new PrismaDeploymentConnectionStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentConnectionStore>[0],
  );
  const deploymentStore = new PrismaDeploymentStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentStore>[0],
  );
  const recommendationStore = new PrismaRecommendationStore(
    prismaClient as ConstructorParameters<typeof PrismaRecommendationStore>[0],
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
    markRecommendationActed: buildMarkRecommendationActed(recommendationStore),
  });

  return { intent: RILEY_PAUSE_INTENT, handler };
}
