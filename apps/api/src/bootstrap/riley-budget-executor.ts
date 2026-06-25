import type { WorkflowHandler, WorkTraceStore } from "@switchboard/core/platform";
import type { MarkActedByExecutionResult } from "@switchboard/db";
import { ExecutionReceiptSchema } from "@switchboard/schemas";
import {
  buildRileyBudgetExecutionWorkflow,
  RILEY_REALLOCATE_EXECUTION_RESOLVED_BY,
  type RileyBudgetCredsResult,
  type RileyBudgetExecutionDeps,
} from "../services/workflows/riley-budget-execution-workflow.js";

/**
 * Last-mile approval + content-binding reader for the reallocate executor (Spec-1B 1B-1.5b). Like
 * the pause `buildGetApprovalState`, but ALSO surfaces the receipt's binding inputs from the
 * canonical WorkTrace: approvedLifecycleId <- `trace.approvalId`, bindingHash <- `trace.contentHash`,
 * workTraceId <- `trace.traceId`. ORG-SCOPED: a trace whose organizationId differs from the work
 * unit's (or an absent trace) reads as no approval, so the executor fails closed rather than ever
 * trusting another tenant's trace. Extracted + exported so the guard is unit-testable without
 * standing up the executor.
 */
export function buildGetReallocateApprovalContext(
  workTraceStore: Pick<WorkTraceStore, "getByWorkUnitId">,
): RileyBudgetExecutionDeps["getApprovalContext"] {
  return async ({ organizationId, workUnitId }) => {
    const read = await workTraceStore.getByWorkUnitId(workUnitId);
    if (!read || read.trace.organizationId !== organizationId) {
      return {};
    }
    return {
      approvalOutcome: read.trace.approvalOutcome,
      approvedLifecycleId: read.trace.approvalId,
      bindingHash: read.trace.contentHash,
      workTraceId: read.trace.traceId,
    };
  };
}

/**
 * Read a prior reallocation success receipt from the canonical WorkTrace.executionOutputs (the
 * replay no-op source). Only consulted AFTER the marker reports "applied" for THIS work unit, and
 * getApprovalContext already org-gated the unit, so no second org check is needed here. A receipt
 * that no longer validates returns undefined, which the executor treats as recovery-required.
 */
export function buildGetExistingReceipt(
  workTraceStore: Pick<WorkTraceStore, "getByWorkUnitId">,
): RileyBudgetExecutionDeps["getExistingReceipt"] {
  return async (workUnitId) => {
    const read = await workTraceStore.getByWorkUnitId(workUnitId);
    const candidate = read?.trace.executionOutputs?.receipt;
    if (!candidate) return undefined;
    const parsed = ExecutionReceiptSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
  };
}

/**
 * The reallocate-specific markRecommendationActed builder. Distinct from the pause builder ONLY
 * because the resolvedBy sentinel differs (RILEY_REALLOCATE_EXECUTION_RESOLVED_BY, never the pause
 * value): reusing the pause builder would stamp the wrong machine provenance on a reallocation. The
 * type-only db import above is erased at build time.
 */
export function buildMarkReallocateRecommendationActed(store: {
  markActedByExecution(args: {
    id: string;
    organizationId: string;
    executableWorkUnitId: string;
    resolvedBy: string;
    executedAt: Date;
  }): Promise<MarkActedByExecutionResult>;
}): RileyBudgetExecutionDeps["markRecommendationActed"] {
  return (args) =>
    store.markActedByExecution({
      id: args.recommendationId,
      organizationId: args.organizationId,
      executableWorkUnitId: args.executableWorkUnitId,
      resolvedBy: RILEY_REALLOCATE_EXECUTION_RESOLVED_BY,
      executedAt: args.executedAt,
    });
}

/**
 * Bootstrap wiring for the Spec-1B reallocate executor (1B-1.5b). Replaces the 1B-1.2 fail-closed
 * placeholder with the real read-modify-re-read executor (approval + content-binding check,
 * replay-first, frozen-account lock, live read, drift check, signed-delta blast-radius cap, durable
 * marker committed before the Meta write, post-write re-read, ExecutionReceipt). Org isolation lives
 * INSIDE the credential resolver: the deployment row's organizationId must equal the work unit's
 * before any credential decrypts (a missing deployment maps to org_mismatch, the safe direction).
 */
export async function buildRileyBudgetExecutorHandler(
  prismaClient: unknown,
  workTraceStore: Pick<WorkTraceStore, "getByWorkUnitId">,
): Promise<{ intent: string; handler: WorkflowHandler }> {
  const { RILEY_REALLOCATE_INTENT } =
    await import("../services/workflows/riley-budget-submit-request.js");
  const {
    PrismaDeploymentConnectionStore,
    PrismaDeploymentStore,
    PrismaRecommendationStore,
    PrismaMetaMutationAttemptStore,
    decryptCredentials,
  } = await import("@switchboard/db");
  const { MetaAdsClient, DEFAULT_BLAST_RADIUS_CONTRACT } =
    await import("@switchboard/ad-optimizer");

  const connectionStore = new PrismaDeploymentConnectionStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentConnectionStore>[0],
  );
  const deploymentStore = new PrismaDeploymentStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentStore>[0],
  );
  const recommendationStore = new PrismaRecommendationStore(
    prismaClient as ConstructorParameters<typeof PrismaRecommendationStore>[0],
  );
  const attemptStore = new PrismaMetaMutationAttemptStore(
    prismaClient as ConstructorParameters<typeof PrismaMetaMutationAttemptStore>[0],
  );

  const handler = buildRileyBudgetExecutionWorkflow({
    getApprovalContext: buildGetReallocateApprovalContext(workTraceStore),
    // In-flight kill-switch: read the per-deployment governanceSettings.reallocateKillSwitch at the
    // last mile. A deployment that is missing or whose org differs reads as KILLED (true) - the safe
    // direction (refuse rather than execute on an unverifiable deployment). Runtime-flippable via
    // setRileyReallocateKillSwitch (scripts/riley-reallocate-kill-switch.ts), no redeploy.
    isReallocateKilled: async ({ organizationId, deploymentId }) => {
      const deployment = await deploymentStore.findById(deploymentId);
      if (!deployment || deployment.organizationId !== organizationId) return true;
      const settings = (deployment.governanceSettings as Record<string, unknown> | null) ?? {};
      return settings["reallocateKillSwitch"] === true;
    },
    getDeploymentCredentials: async (
      organizationId,
      deploymentId,
    ): Promise<RileyBudgetCredsResult> => {
      const deployment = await deploymentStore.findById(deploymentId);
      if (!deployment || deployment.organizationId !== organizationId) {
        return { kind: "org_mismatch" as const };
      }
      const conn = await connectionStore.findByDeploymentAndType(deploymentId, "meta-ads");
      if (!conn) return { kind: "none" as const };
      // A corrupt/undecryptable connection maps to the documented "no decryptable meta-ads
      // connection" contract (kind:"none" -> NO_META_CONNECTION), not an unclassified reject.
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
    attemptStore,
    getExistingReceipt: buildGetExistingReceipt(workTraceStore),
    markRecommendationActed: buildMarkReallocateRecommendationActed(recommendationStore),
    contract: DEFAULT_BLAST_RADIUS_CONTRACT,
  });

  return { intent: RILEY_REALLOCATE_INTENT, handler };
}
