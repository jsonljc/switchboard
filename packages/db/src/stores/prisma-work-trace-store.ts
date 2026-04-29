import type { PrismaClient } from "@prisma/client";
import type {
  WorkTrace,
  WorkTraceStore,
  WorkTraceUpdateResult,
  WorkTraceLockDiagnostic,
  WorkTraceReadResult,
  IntegrityVerdict,
} from "@switchboard/core/platform";
import {
  validateUpdate,
  WorkTraceLockedError,
  computeWorkTraceContentHash,
  verifyWorkTraceIntegrity,
} from "@switchboard/core/platform";
import type { AuditLedger, OperatorAlerter } from "@switchboard/core";
import { buildInfrastructureFailureAuditParams, safeAlert } from "@switchboard/core";
import type { InfrastructureFailureAlert } from "@switchboard/core";
import { WORK_TRACE_INTEGRITY_CUTOFF_AT } from "../integrity-cutoff.js";

export interface PrismaWorkTraceStoreConfig {
  auditLedger: AuditLedger;
  operatorAlerter: OperatorAlerter;
}

export class PrismaWorkTraceStore implements WorkTraceStore {
  private readonly auditLedger: AuditLedger;
  private readonly operatorAlerter: OperatorAlerter;

  constructor(
    private readonly prisma: PrismaClient,
    config: PrismaWorkTraceStoreConfig,
  ) {
    if (!config || !config.auditLedger || !config.operatorAlerter) {
      throw new Error("PrismaWorkTraceStore requires auditLedger and operatorAlerter");
    }
    this.auditLedger = config.auditLedger;
    this.operatorAlerter = config.operatorAlerter;
  }

  async persist(trace: WorkTrace): Promise<void> {
    const traceVersion = 1;
    const contentHash = computeWorkTraceContentHash(trace, traceVersion);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workTrace.create({
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
            deploymentContext: trace.deploymentContext
              ? JSON.stringify(trace.deploymentContext)
              : null,

            governanceOutcome: trace.governanceOutcome,
            riskScore: trace.riskScore,
            matchedPolicies: JSON.stringify(trace.matchedPolicies),
            governanceConstraints: trace.governanceConstraints
              ? JSON.stringify(trace.governanceConstraints)
              : null,

            approvalId: trace.approvalId ?? null,
            approvalOutcome: trace.approvalOutcome ?? null,
            approvalRespondedBy: trace.approvalRespondedBy ?? null,
            approvalRespondedAt: trace.approvalRespondedAt
              ? new Date(trace.approvalRespondedAt)
              : null,

            outcome: trace.outcome,
            durationMs: trace.durationMs,
            errorCode: trace.error?.code ?? null,
            errorMessage: trace.error?.message ?? null,
            executionSummary: trace.executionSummary ?? null,
            executionOutputs: trace.executionOutputs
              ? JSON.stringify(trace.executionOutputs)
              : null,

            modeMetrics: trace.modeMetrics ? JSON.stringify(trace.modeMetrics) : null,
            requestedAt: new Date(trace.requestedAt),
            governanceCompletedAt: new Date(trace.governanceCompletedAt),
            executionStartedAt: trace.executionStartedAt
              ? new Date(trace.executionStartedAt)
              : null,
            idempotencyKey: trace.idempotencyKey ?? null,
            completedAt: trace.completedAt ? new Date(trace.completedAt) : null,
            contentHash,
            traceVersion,
          },
        });

        await this.auditLedger.record(
          {
            eventType: "work_trace.persisted",
            actorType: trace.actor.type === "service" ? "service_account" : trace.actor.type,
            actorId: trace.actor.id,
            entityType: "work_trace",
            entityId: trace.workUnitId,
            riskCategory: "low",
            visibilityLevel: "system",
            summary: `WorkTrace ${trace.workUnitId} persisted at v${traceVersion}`,
            organizationId: trace.organizationId,
            traceId: trace.traceId,
            snapshot: {
              workUnitId: trace.workUnitId,
              traceId: trace.traceId,
              contentHash,
              traceVersion,
              hashAlgorithm: "sha256",
              hashVersion: 1,
            },
          },
          { tx },
        );
      });
    } catch (err: unknown) {
      if (this.isUniqueConstraintError(err) && trace.idempotencyKey) {
        return;
      }
      throw err;
    }
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    );
  }

  async getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadResult | null> {
    const row = await this.prisma.workTrace.findUnique({ where: { workUnitId } });
    if (!row) return null;
    return this.verifyAndWrap(row);
  }

  async getByIdempotencyKey(key: string): Promise<WorkTraceReadResult | null> {
    const row = await this.prisma.workTrace.findUnique({ where: { idempotencyKey: key } });
    if (!row) return null;
    return this.verifyAndWrap(row);
  }

  private async verifyAndWrap(
    row: NonNullable<Awaited<ReturnType<typeof this.prisma.workTrace.findUnique>>>,
  ): Promise<WorkTraceReadResult> {
    const trace = this.mapRowToTrace(row);
    let anchor = null;
    try {
      if (row.contentHash !== null && row.traceVersion > 0) {
        anchor = await this.auditLedger.findAnchor({
          entityType: "work_trace",
          entityId: row.workUnitId,
          eventType: row.traceVersion === 1 ? "work_trace.persisted" : "work_trace.updated",
          traceVersion: row.traceVersion,
        });
      }
    } catch (err) {
      console.error("[PrismaWorkTraceStore] findAnchor failed", err);
      await safeAlert(
        this.operatorAlerter,
        this.buildIntegrityAlert("integrity_check_unavailable", trace, null, null),
      );
      return {
        trace,
        integrity: { status: "missing_anchor", expectedAtVersion: row.traceVersion },
      };
    }

    const integrity = verifyWorkTraceIntegrity({
      trace,
      rowContentHash: row.contentHash,
      rowTraceVersion: row.traceVersion,
      rowRequestedAt: row.requestedAt.toISOString(),
      anchor,
      cutoffAt: WORK_TRACE_INTEGRITY_CUTOFF_AT,
    });

    if (integrity.status === "mismatch" || integrity.status === "missing_anchor") {
      const errorType =
        integrity.status === "mismatch"
          ? "work_trace_integrity_mismatch"
          : "work_trace_integrity_missing_anchor";
      await safeAlert(
        this.operatorAlerter,
        this.buildIntegrityAlert(errorType, trace, row.contentHash, integrity),
      );
    }

    return { trace, integrity };
  }

  private buildIntegrityAlert(
    errorType:
      | "work_trace_integrity_mismatch"
      | "work_trace_integrity_missing_anchor"
      | "integrity_check_unavailable",
    trace: WorkTrace,
    _storedHash: string | null,
    integrity: IntegrityVerdict | null,
  ): InfrastructureFailureAlert {
    const message =
      integrity && integrity.status === "mismatch"
        ? `WorkTrace contentHash mismatch (expected ${integrity.expected}, got ${integrity.actual})`
        : integrity && integrity.status === "missing_anchor"
          ? `WorkTrace anchor missing at version ${integrity.expectedAtVersion}`
          : "WorkTrace integrity check unavailable";
    return {
      errorType,
      severity: errorType === "work_trace_integrity_mismatch" ? "critical" : "warning",
      errorMessage: message,
      intent: trace.intent,
      traceId: trace.traceId,
      organizationId: trace.organizationId,
      retryable: false,
      occurredAt: new Date().toISOString(),
      source: "platform_ingress",
    };
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
      lockedAt: row.lockedAt?.toISOString(),
      contentHash: row.contentHash ?? undefined,
      traceVersion: row.traceVersion,
    };
  }

  async update(
    workUnitId: string,
    fields: Partial<WorkTrace>,
    options?: { caller?: string },
  ): Promise<WorkTraceUpdateResult> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.workTrace.findUnique({ where: { workUnitId } });
      if (!row) {
        throw new Error(`WorkTrace not found: ${workUnitId}`);
      }
      const current = this.mapRowToTrace(row);
      const validation = validateUpdate({
        current,
        update: fields,
        caller: options?.caller,
      });
      if (!validation.ok) {
        await this.handleViolation(validation.diagnostic);
        if (process.env.NODE_ENV !== "production") {
          throw new WorkTraceLockedError(validation.diagnostic);
        }
        return {
          ok: false as const,
          code: "WORK_TRACE_LOCKED" as const,
          traceUnchanged: true as const,
          reason: validation.diagnostic.reason,
        };
      }

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
      if (fields.parameters !== undefined) data.parameters = JSON.stringify(fields.parameters);

      if (validation.computedLockedAt !== null) {
        data.lockedAt = new Date(validation.computedLockedAt);
      }

      // Hash-relevance check: lockedAt is excluded from the hash, so a
      // lockedAt-only write does not bump version or anchor.
      const hashRelevantKeys = Object.keys(data).filter(
        (k) => k !== "lockedAt" && k !== "contentHash" && k !== "traceVersion",
      );

      if (hashRelevantKeys.length === 0) {
        if (Object.keys(data).length === 0) {
          // No-op: caller passed no actionable fields.
          return { ok: true as const, trace: this.mapRowToTrace(row) };
        }
        // lockedAt-only: persist the lock, skip version bump + anchor.
        const updatedRow = await tx.workTrace.update({ where: { workUnitId }, data });
        return { ok: true as const, trace: this.mapRowToTrace(updatedRow) };
      }

      const previousVersion = row.traceVersion;
      const nextVersion = previousVersion + 1;

      // Build merged trace to compute the new hash.
      const merged: WorkTrace = { ...current, ...fields };
      const nextHash = computeWorkTraceContentHash(merged, nextVersion);

      data.contentHash = nextHash;
      data.traceVersion = nextVersion;

      const updatedRow = await tx.workTrace.update({ where: { workUnitId }, data });

      await this.auditLedger.record(
        {
          eventType: "work_trace.updated",
          actorType: "system",
          actorId: options?.caller ?? "unknown",
          entityType: "work_trace",
          entityId: workUnitId,
          riskCategory: "low",
          visibilityLevel: "system",
          summary: `WorkTrace ${workUnitId} updated to v${nextVersion}`,
          organizationId: current.organizationId,
          traceId: current.traceId,
          snapshot: {
            workUnitId,
            traceId: current.traceId,
            contentHash: nextHash,
            traceVersion: nextVersion,
            previousHash: row.contentHash ?? null,
            previousVersion,
            changedFields: hashRelevantKeys,
            hashAlgorithm: "sha256",
            hashVersion: 1,
          },
        },
        { tx },
      );

      return { ok: true as const, trace: this.mapRowToTrace(updatedRow) };
    });
  }

  private async handleViolation(diagnostic: WorkTraceLockDiagnostic): Promise<void> {
    const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
      errorType: "work_trace_locked_violation",
      error: new Error(diagnostic.reason),
      retryable: false,
      workUnit: {
        id: diagnostic.workUnitId,
        intent: diagnostic.intent,
        traceId: diagnostic.traceId,
        organizationId: diagnostic.organizationId,
      },
    });
    const enrichedSnapshot = {
      ...ledgerParams.snapshot,
      currentOutcome: diagnostic.currentOutcome,
      lockedAt: diagnostic.lockedAt,
      rejectedFields: diagnostic.rejectedFields,
      caller: diagnostic.caller,
    };
    try {
      await this.auditLedger.record({
        ...ledgerParams,
        snapshot: enrichedSnapshot as unknown as Record<string, unknown>,
      });
    } catch (auditErr) {
      console.error(
        "[PrismaWorkTraceStore] failed to record work_trace_locked_violation audit",
        auditErr,
      );
    }
    await safeAlert(this.operatorAlerter, alert);
  }
}
