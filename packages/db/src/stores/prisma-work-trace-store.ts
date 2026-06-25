/* eslint-disable max-lines -- this file crossed the 600-line guideline when the
   D1 claim() idempotency primitive was added (PR #780). Suggested seam: extract
   the row<->trace serialization (buildWorkTraceCreateData/mapRowToTrace/
   parseQualificationSignals) into a prisma-work-trace-serde module. Remove this
   disable when the file is split. */
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  WorkTrace,
  WorkTraceStore,
  WorkTraceUpdateResult,
  WorkTraceClaimResult,
  WorkTraceLockDiagnostic,
  WorkTraceReadResult,
  StrandedRunningClaim,
  IntegrityVerdict,
} from "@switchboard/core/platform";
import {
  validateUpdate,
  WorkTraceLockedError,
  computeWorkTraceContentHash,
  verifyWorkTraceIntegrity,
  WORK_TRACE_HASH_VERSION_LATEST,
} from "@switchboard/core/platform";
import {
  WorkTraceQualificationSignalsSchema,
  type WorkTraceQualificationSignals,
} from "@switchboard/schemas";
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
    const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
    const contentHash = computeWorkTraceContentHash(trace, traceVersion);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workTrace.create({
          data: this.buildWorkTraceCreateData(trace, {
            traceVersion,
            contentHash,
            hashInputVersion,
          }),
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
              hashVersion: hashInputVersion,
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

  /**
   * D1 idempotency claim: insert a `running` WorkTrace BEFORE the domain
   * mutation. Mirrors persist() (trace + paired anchor in one $transaction) but
   * REPORTS the idempotency-key P2002 as `{ claimed: false }` instead of
   * swallowing it to void — that return value is the concurrency lock for
   * PlatformIngress's claim-first execute path. Non-P2002 errors throw so the
   * caller can retry.
   */
  async claim(trace: WorkTrace): Promise<WorkTraceClaimResult> {
    const traceVersion = 1;
    const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
    const contentHash = computeWorkTraceContentHash(trace, traceVersion);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workTrace.create({
          data: this.buildWorkTraceCreateData(trace, {
            traceVersion,
            contentHash,
            hashInputVersion,
          }),
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
            summary: `WorkTrace ${trace.workUnitId} claimed at v${traceVersion}`,
            organizationId: trace.organizationId,
            traceId: trace.traceId,
            snapshot: {
              workUnitId: trace.workUnitId,
              traceId: trace.traceId,
              contentHash,
              traceVersion,
              hashAlgorithm: "sha256",
              hashVersion: hashInputVersion,
            },
          },
          { tx },
        );
      });
      return { claimed: true };
    } catch (err: unknown) {
      // A P2002 here is treated as "lost the idempotency-key claim". We do not
      // inspect err.meta.target to confirm it was the (org, idempotencyKey)
      // unique rather than the workUnitId @unique — intentional, and identical
      // to persist()'s guard above: workUnitId is a fresh per-submit cuid (a PK
      // collision is not reachable), and failing closed on the unlikely case is
      // the safe direction (it can never cause a double-apply).
      if (this.isUniqueConstraintError(err) && trace.idempotencyKey) {
        return { claimed: false };
      }
      throw err;
    }
  }

  /**
   * Atomically insert a WorkTrace row inside a caller-owned transaction.
   *
   * Used by callers that need the WorkTrace insert to commit/rollback alongside
   * their own state mutation (e.g., ConversationStateStore writes). The audit-ledger
   * insert is intentionally OUTSIDE the caller's tx — and its failures are swallowed
   * (logged via console.error, not thrown) because this method is called inside the
   * caller's $transaction callback: a thrown audit-ledger error would propagate up
   * and roll back the caller's state mutation, defeating the design. The state
   * mutation + WorkTrace insert atomicity is the load-bearing invariant; the
   * audit-ledger row is observability and degrades gracefully — a missing anchor
   * surfaces on next read via verifyAndWrap's findAnchor path.
   */
  async recordOperatorMutation(
    trace: WorkTrace,
    ctx: { tx: Prisma.TransactionClient },
  ): Promise<void> {
    if (trace.ingressPath !== "store_recorded_operator_mutation") {
      throw new Error(
        `recordOperatorMutation requires trace.ingressPath === "store_recorded_operator_mutation" (got ${
          trace.ingressPath ?? "undefined"
        })`,
      );
    }

    const traceVersion = 1;
    const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
    const contentHash = computeWorkTraceContentHash(trace, traceVersion);

    await ctx.tx.workTrace.create({
      data: this.buildWorkTraceCreateData(trace, {
        traceVersion,
        contentHash,
        hashInputVersion,
      }),
    });

    // Audit-ledger record is observability and must not block the caller's tx.
    // We are still inside the caller's $transaction callback at this point, so a
    // thrown error here would reject the callback and roll back the caller's state
    // mutation. Swallow ledger failures (log + continue) — the missing anchor is
    // surfaced on next read via verifyAndWrap's findAnchor path.
    try {
      await this.auditLedger.record({
        eventType: "work_trace.persisted",
        actorType: trace.actor.type === "service" ? "service_account" : trace.actor.type,
        actorId: trace.actor.id,
        entityType: "work_trace",
        entityId: trace.workUnitId,
        riskCategory: "low",
        visibilityLevel: "system",
        summary: `WorkTrace ${trace.workUnitId} persisted at v${traceVersion} (operator mutation)`,
        organizationId: trace.organizationId,
        traceId: trace.traceId,
        snapshot: {
          workUnitId: trace.workUnitId,
          traceId: trace.traceId,
          contentHash,
          traceVersion,
          hashAlgorithm: "sha256",
          hashVersion: hashInputVersion,
          ingressPath: trace.ingressPath,
        },
      });
    } catch (auditErr) {
      console.error(
        `[PrismaWorkTraceStore] recordOperatorMutation audit-ledger record failed for ${trace.workUnitId}; WorkTrace row was inserted in caller's tx`,
        auditErr,
      );
    }
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
      contactId: trace.contactId ?? null,
      conversationThreadId: trace.conversationThreadId ?? null,

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
      ingressPath: trace.ingressPath, // explicit; should always be set by buildWorkTrace
      hashInputVersion: opts.hashInputVersion,
    };
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

  async getByIdempotencyKey(
    organizationId: string,
    key: string,
  ): Promise<WorkTraceReadResult | null> {
    // Scoped to the (organizationId, idempotencyKey) unique. A global lookup by
    // key alone could return another tenant's WorkTrace when two orgs share a
    // key, leaking its outputs/parameters back through PlatformIngress's replay.
    const row = await this.prisma.workTrace.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: key } },
    });
    if (!row) return null;
    return this.verifyAndWrap(row);
  }

  /**
   * EV-2 / SPINE-2 — the bounded scan the stranded-claim reaper runs. Returns
   * orphaned idempotency CLAIMS: rows still `running` with a non-null
   * idempotencyKey whose executionStartedAt predates `olderThan`. The
   * `idempotencyKey: { not: null }` filter is load-bearing: it excludes the
   * KEYLESS `running` rows that conversation/lifecycle turns persist (those are
   * live in-flight turns finalized by their own machinery — reaping them would
   * break active conversations). Oldest-first, capped at `limit`. A narrow
   * `select` (no integrity verify) — the reaper only needs the dead-letter
   * identity, not the full hashed trace.
   */
  async findStuckRunning(olderThan: Date, limit: number): Promise<StrandedRunningClaim[]> {
    const rows = await this.prisma.workTrace.findMany({
      where: {
        outcome: "running",
        idempotencyKey: { not: null },
        executionStartedAt: { lt: olderThan },
      },
      orderBy: { executionStartedAt: "asc" },
      take: limit,
      select: {
        workUnitId: true,
        organizationId: true,
        idempotencyKey: true,
        intent: true,
        traceId: true,
        executionStartedAt: true,
      },
    });
    return rows.map((row) => ({
      workUnitId: row.workUnitId,
      organizationId: row.organizationId,
      idempotencyKey: row.idempotencyKey ?? null,
      intent: row.intent,
      traceId: row.traceId,
      executionStartedAt: row.executionStartedAt?.toISOString() ?? null,
    }));
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

  private parseQualificationSignals(
    raw: string | null,
    workUnitId: string,
  ): WorkTraceQualificationSignals | null {
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(
        `[PrismaWorkTraceStore] qualificationSignals JSON.parse failed for workUnitId=${workUnitId} — returning null`,
      );
      return null;
    }
    const result = WorkTraceQualificationSignalsSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(
        `[PrismaWorkTraceStore] qualificationSignals schema validation failed for workUnitId=${workUnitId} — returning null`,
        result.error.issues,
      );
      return null;
    }
    return result.data;
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
      injectedPatternIds: row.injectedPatternIds ?? [],
      contactId: row.contactId ?? undefined,
      conversationThreadId: row.conversationThreadId ?? undefined,

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
      // Integrity invariant: pre-migration rows have hashInputVersion = 1 from the
      // migration default; copying it through preserves their contentHash verification
      // path. Without this, update() would silently re-hash pre-migration rows at v2
      // (LATEST) and break round-trip integrity for those rows.
      ingressPath: (row.ingressPath ?? "platform_ingress") as WorkTrace["ingressPath"],
      hashInputVersion: row.hashInputVersion ?? 1,
      qualificationSignals: this.parseQualificationSignals(
        row.qualificationSignals ?? null,
        row.workUnitId,
      ),
    };
  }

  async update(
    workUnitId: string,
    fields: Partial<WorkTrace>,
    options?: { caller?: string; organizationId?: string },
  ): Promise<WorkTraceUpdateResult> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.workTrace.findUnique({ where: { workUnitId } });
      if (!row) {
        throw new Error(`WorkTrace not found: ${workUnitId}`);
      }
      const current = this.mapRowToTrace(row);
      // Opt-in tenant tripwire (#643): when a caller supplies an expected org,
      // a row owned by a different tenant is treated as not-found. The throw
      // rolls back the transaction before any mutation. Omitting organizationId
      // preserves the unscoped workUnitId path (PK-like unique key).
      if (
        options?.organizationId !== undefined &&
        current.organizationId !== options.organizationId
      ) {
        throw new Error(`WorkTrace not found: ${workUnitId}`);
      }
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
      if (fields.injectedPatternIds !== undefined)
        data.injectedPatternIds = fields.injectedPatternIds;
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
        // Keyed by the unique workUnitId (PK-like); tenant scoping is enforced
        // by the opt-in organizationId tripwire above, not the WHERE clause.
        // route-governance: store-mutation-global
        const updatedRow = await tx.workTrace.update({ where: { workUnitId }, data });
        return { ok: true as const, trace: this.mapRowToTrace(updatedRow) };
      }

      const previousVersion = row.traceVersion;
      const nextVersion = previousVersion + 1;

      // Build merged trace to compute the new hash.
      const merged: WorkTrace = { ...current, ...fields };
      const hashInputVersion = merged.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
      const nextHash = computeWorkTraceContentHash(merged, nextVersion);

      data.contentHash = nextHash;
      data.traceVersion = nextVersion;

      // Keyed by the unique workUnitId (PK-like); tenant scoping is enforced
      // by the opt-in organizationId tripwire above, not the WHERE clause.
      // route-governance: store-mutation-global
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
            hashVersion: hashInputVersion,
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
