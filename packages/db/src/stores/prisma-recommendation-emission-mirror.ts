import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  PersistRecommendationInput,
  Recommendation,
  RecommendationEmissionMirror,
} from "@switchboard/core";
import type { WorkTrace } from "@switchboard/core/platform";
import {
  computeWorkTraceContentHash,
  WORK_TRACE_HASH_VERSION_LATEST,
} from "@switchboard/core/platform";
import { rowToRecommendation } from "../recommendation-store.js";

/**
 * Production mirror: opens prisma.$transaction, creates the PendingActionRecord
 * row + the WorkTrace row inside the same transaction. Either both commit or
 * both roll back.
 *
 * Idempotency: when PendingActionRecord.create raises P2002 (unique constraint
 * violation on idempotencyKey), the existing recommendation row is fetched and
 * returned; the WorkTrace insert is intentionally skipped to preserve substrate
 * symmetry (one Recommendation == one WorkTrace per idempotencyKey).
 */
export class PrismaRecommendationEmissionMirror implements RecommendationEmissionMirror {
  constructor(private readonly prisma: PrismaClient) {}

  async recordEmission(args: {
    recommendationInsert: PersistRecommendationInput;
    workTrace: WorkTrace;
  }): Promise<{ row: Recommendation; idempotent: boolean }> {
    const { recommendationInsert: input, workTrace } = args;
    const traceVersion = 1;
    const hashInputVersion = workTrace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
    const contentHash = computeWorkTraceContentHash(workTrace, traceVersion);

    return this.prisma.$transaction(async (tx) => {
      let recommendationRow: Awaited<ReturnType<typeof tx.pendingActionRecord.create>>;
      try {
        recommendationRow = await tx.pendingActionRecord.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            status: "pending",
            intent: input.intent,
            targetEntities: (input.targetEntities ?? {}) as object,
            parameters: input.parameters as object,
            humanSummary: input.humanSummary,
            confidence: input.confidence,
            riskLevel: input.riskLevel,
            dollarsAtRisk: input.dollarsAtRisk,
            requiredCapabilities: [],
            dryRunSupported: false,
            approvalRequired: "operator",
            sourceAgent: input.agentKey,
            sourceWorkflow: input.sourceWorkflow ?? null,
            organizationId: input.orgId,
            surface: input.surface,
            undoableUntil: input.undoableUntil,
            expiresAt: input.expiresAt,
          },
        });
      } catch (err: unknown) {
        if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
          const existing = await tx.pendingActionRecord.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
          });
          if (!existing) {
            throw new Error(
              `idempotencyKey collision raised P2002 but findUnique returned null for ${input.idempotencyKey}`,
            );
          }
          return { row: rowToRecommendation(existing), idempotent: true };
        }
        throw err;
      }

      // Insert the WorkTrace row inside the same transaction. If this throws,
      // the entire transaction rolls back including the PendingActionRecord row.
      await tx.workTrace.create({
        data: this.buildWorkTraceCreateData(workTrace, {
          traceVersion,
          contentHash,
          hashInputVersion,
        }),
      });

      return { row: rowToRecommendation(recommendationRow), idempotent: false };
    });
  }

  private buildWorkTraceCreateData(
    trace: WorkTrace,
    opts: { traceVersion: number; contentHash: string; hashInputVersion: number },
  ): Prisma.WorkTraceUncheckedCreateInput {
    return {
      workUnitId: trace.workUnitId,
      traceId: trace.traceId,
      parentWorkUnitId: trace.parentWorkUnitId ?? null,
      intent: trace.intent,
      mode: trace.mode,
      organizationId: trace.organizationId,
      actorId: trace.actor.id,
      actorType: trace.actor.type,
      trigger: trace.trigger,
      parameters: trace.parameters ? JSON.stringify(trace.parameters) : null,
      deploymentContext: trace.deploymentContext ? JSON.stringify(trace.deploymentContext) : null,
      governanceOutcome: trace.governanceOutcome,
      riskScore: trace.riskScore,
      matchedPolicies: JSON.stringify(trace.matchedPolicies),
      governanceConstraints: trace.governanceConstraints
        ? JSON.stringify(trace.governanceConstraints)
        : null,
      approvalId: trace.approvalId ?? null,
      approvalOutcome: trace.approvalOutcome ?? null,
      approvalRespondedBy: trace.approvalRespondedBy ?? null,
      approvalRespondedAt: trace.approvalRespondedAt ? new Date(trace.approvalRespondedAt) : null,
      outcome: trace.outcome,
      durationMs: trace.durationMs,
      errorCode: trace.error?.code ?? null,
      errorMessage: trace.error?.message ?? null,
      executionSummary: trace.executionSummary ?? null,
      executionOutputs: trace.executionOutputs ? JSON.stringify(trace.executionOutputs) : null,
      injectedPatternIds: trace.injectedPatternIds ?? [],
      modeMetrics: trace.modeMetrics ? JSON.stringify(trace.modeMetrics) : null,
      qualificationSignals: trace.qualificationSignals
        ? JSON.stringify(trace.qualificationSignals)
        : null,
      requestedAt: new Date(trace.requestedAt),
      governanceCompletedAt: new Date(trace.governanceCompletedAt),
      executionStartedAt: trace.executionStartedAt ? new Date(trace.executionStartedAt) : null,
      idempotencyKey: trace.idempotencyKey ?? null,
      completedAt: trace.completedAt ? new Date(trace.completedAt) : null,
      contentHash: opts.contentHash,
      traceVersion: opts.traceVersion,
      ingressPath: trace.ingressPath,
      hashInputVersion: opts.hashInputVersion,
    };
  }
}
