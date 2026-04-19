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

        modeMetrics: trace.modeMetrics ? JSON.stringify(trace.modeMetrics) : null,
        requestedAt: new Date(trace.requestedAt),
        governanceCompletedAt: new Date(trace.governanceCompletedAt),
        executionStartedAt: trace.executionStartedAt ? new Date(trace.executionStartedAt) : null,
        idempotencyKey: trace.idempotencyKey ?? null,
        completedAt: trace.completedAt ? new Date(trace.completedAt) : null,
      },
    });
  }

  async getByWorkUnitId(workUnitId: string): Promise<WorkTrace | null> {
    const row = await this.prisma.workTrace.findUnique({ where: { workUnitId } });
    if (!row) return null;
    return this.mapRowToTrace(row);
  }

  async getByIdempotencyKey(key: string): Promise<WorkTrace | null> {
    const row = await this.prisma.workTrace.findUnique({ where: { idempotencyKey: key } });
    if (!row) return null;
    return this.mapRowToTrace(row);
  }

  private mapRowToTrace(
    row: NonNullable<Awaited<ReturnType<typeof this.prisma.workTrace.findUnique>>>,
  ): WorkTrace {
    return {
      workUnitId: row.workUnitId,
      traceId: row.traceId,
      parentWorkUnitId: row.parentWorkUnitId ?? undefined,
      deploymentId: undefined,
      intent: row.intent,
      mode: row.mode as WorkTrace["mode"],
      organizationId: row.organizationId,
      actor: { id: row.actorId, type: row.actorType as WorkTrace["actor"]["type"] },
      trigger: row.trigger as WorkTrace["trigger"],
      idempotencyKey: row.idempotencyKey ?? undefined,

      parameters: row.parameters
        ? (JSON.parse(row.parameters) as Record<string, unknown>)
        : undefined,
      deploymentContext: row.deploymentContext
        ? (JSON.parse(row.deploymentContext) as WorkTrace["deploymentContext"])
        : undefined,

      governanceOutcome: row.governanceOutcome as WorkTrace["governanceOutcome"],
      riskScore: row.riskScore,
      matchedPolicies: JSON.parse(row.matchedPolicies) as string[],
      governanceConstraints: row.governanceConstraints
        ? (JSON.parse(row.governanceConstraints) as WorkTrace["governanceConstraints"])
        : undefined,

      approvalId: row.approvalId ?? undefined,
      approvalOutcome: row.approvalOutcome as WorkTrace["approvalOutcome"],
      approvalRespondedBy: row.approvalRespondedBy ?? undefined,
      approvalRespondedAt: row.approvalRespondedAt?.toISOString(),

      outcome: row.outcome as WorkTrace["outcome"],
      durationMs: row.durationMs,
      error:
        row.errorCode || row.errorMessage
          ? { code: row.errorCode ?? "UNKNOWN", message: row.errorMessage ?? "" }
          : undefined,
      executionSummary: row.executionSummary ?? undefined,
      executionOutputs: row.executionOutputs
        ? (JSON.parse(row.executionOutputs) as Record<string, unknown>)
        : undefined,

      modeMetrics: row.modeMetrics
        ? (JSON.parse(row.modeMetrics) as Record<string, unknown>)
        : undefined,
      requestedAt: row.requestedAt.toISOString(),
      governanceCompletedAt: row.governanceCompletedAt.toISOString(),
      executionStartedAt: row.executionStartedAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
    };
  }

  async update(workUnitId: string, fields: Partial<WorkTrace>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (fields.outcome !== undefined) data.outcome = fields.outcome;
    if (fields.durationMs !== undefined) data.durationMs = fields.durationMs;
    if (fields.error !== undefined) {
      data.errorCode = fields.error?.code ?? null;
      data.errorMessage = fields.error?.message ?? null;
    }
    if (fields.executionSummary !== undefined) data.executionSummary = fields.executionSummary;
    if (fields.executionOutputs !== undefined)
      data.executionOutputs = JSON.stringify(fields.executionOutputs);
    if (fields.executionStartedAt !== undefined)
      data.executionStartedAt = new Date(fields.executionStartedAt);
    if (fields.completedAt !== undefined) data.completedAt = new Date(fields.completedAt);

    if (fields.approvalId !== undefined) data.approvalId = fields.approvalId;
    if (fields.approvalOutcome !== undefined) data.approvalOutcome = fields.approvalOutcome;
    if (fields.approvalRespondedBy !== undefined)
      data.approvalRespondedBy = fields.approvalRespondedBy;
    if (fields.approvalRespondedAt !== undefined)
      data.approvalRespondedAt = new Date(fields.approvalRespondedAt);

    if (fields.modeMetrics !== undefined) data.modeMetrics = JSON.stringify(fields.modeMetrics);

    if (Object.keys(data).length > 0) {
      await this.prisma.workTrace.update({ where: { workUnitId }, data });
    }
  }
}
