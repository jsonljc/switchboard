import type { PrismaClient } from "@prisma/client";
import type { WorkTrace, WorkTraceStore } from "@switchboard/core/platform";

export class PrismaWorkTraceStore implements WorkTraceStore {
  constructor(private readonly prisma: PrismaClient) {}

  async persist(trace: WorkTrace): Promise<void> {
    await this.prisma.workTrace.create({
      data: {
        workUnitId: trace.workUnitId,
        traceId: trace.traceId,
        parentWorkUnitId: trace.parentWorkUnitId ?? null,
        intent: trace.intent,
        mode: trace.mode,
        organizationId: trace.organizationId,
        actorId: trace.actor.id,
        actorType: trace.actor.type,
        trigger: trace.trigger,
        governanceOutcome: trace.governanceOutcome,
        riskScore: trace.riskScore,
        matchedPolicies: JSON.stringify(trace.matchedPolicies),
        outcome: trace.outcome,
        durationMs: trace.durationMs,
        errorCode: trace.error?.code ?? null,
        errorMessage: trace.error?.message ?? null,
        modeMetrics: trace.modeMetrics ? JSON.stringify(trace.modeMetrics) : null,
        requestedAt: new Date(trace.requestedAt),
        governanceCompletedAt: new Date(trace.governanceCompletedAt),
        executionStartedAt: trace.executionStartedAt ? new Date(trace.executionStartedAt) : null,
        completedAt: trace.completedAt ? new Date(trace.completedAt) : null,
      },
    });
  }
}
