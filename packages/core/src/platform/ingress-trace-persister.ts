import type { GovernanceDecision } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";
import type { WorkUnit } from "./work-unit.js";
import type { WorkTraceStore } from "./work-trace-recorder.js";
import type { AuditLedger } from "../audit/ledger.js";
import type { OperatorAlerter } from "../observability/operator-alerter.js";
import { safeAlert } from "../observability/operator-alerter.js";
import { buildInfrastructureFailureAuditParams } from "../observability/infrastructure-failure.js";
import { buildWorkTrace, buildClaimTrace } from "./work-trace-recorder.js";

export const TRACE_PERSIST_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 100,
  factor: 4,
  jitterRatio: 0.25,
} as const;

const defaultDelayFn = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function jitteredDelayMs(attempt: number): number {
  // attempt is 1-indexed; delay applies BEFORE attempt 2 and BEFORE attempt 3.
  const { baseDelayMs, factor, jitterRatio } = TRACE_PERSIST_RETRY_POLICY;
  const base = baseDelayMs * Math.pow(factor, attempt - 2);
  const jitter = base * jitterRatio;
  return Math.max(0, base + (Math.random() * 2 - 1) * jitter);
}

export interface IngressTracePersisterDeps {
  /** Optional audit sink for terminal infrastructure failures. */
  auditLedger?: AuditLedger;
  /** Operator alerter fired on terminal infrastructure failures. */
  alerter: OperatorAlerter;
  /** Injectable for tests — defaults to setTimeout-based delay. */
  delayFn?: (ms: number) => Promise<void>;
}

/**
 * Owns the trace-persistence orchestration extracted from PlatformIngress
 * (the seam documented by the file's former max-lines disable): the jittered
 * persist/claim/finalize retry loop plus the one-shot infrastructure-failure
 * audit + alert. This is a pure collaborator — PlatformIngress delegates to it
 * with the same arguments it formerly passed to its own private methods, so the
 * observable behavior (retry counts, audit/alert emission, return shapes) is
 * unchanged. The traceStore is passed per-call (it may be undefined) rather
 * than held, matching the original method signatures exactly.
 */
export class IngressTracePersister {
  private readonly auditLedger?: AuditLedger;
  private readonly alerter: OperatorAlerter;
  private readonly delayFn: (ms: number) => Promise<void>;

  constructor(deps: IngressTracePersisterDeps) {
    this.auditLedger = deps.auditLedger;
    this.alerter = deps.alerter;
    this.delayFn = deps.delayFn ?? defaultDelayFn;
  }

  async persistTrace(
    traceStore: WorkTraceStore | undefined,
    workUnit: WorkUnit,
    decision: GovernanceDecision,
    governanceCompletedAt: string,
    executionResult?: ExecutionResult,
    executionStartedAt?: string,
    completedAt?: string,
  ): Promise<void> {
    if (!traceStore) return;
    // Built once outside the retry loop: every attempt persists the same logical
    // WorkTrace (same traceId/workUnitId/idempotencyKey). Do not move inside the loop.
    const trace = buildWorkTrace({
      workUnit,
      governanceDecision: decision,
      governanceCompletedAt,
      executionResult,
      executionStartedAt,
      completedAt,
    });

    const result = await this.runWithRetry(() => traceStore.persist(trace));
    if (!result.ok) {
      // Terminal failure — exactly one infra-failure audit + one alert.
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: result.error,
        workUnit,
        retryable: false,
      });
    }
  }

  /**
   * Run `fn` under the trace-persist retry policy (jittered backoff). Returns
   * the value on success, or the last error if every attempt threw. Never
   * throws — callers decide how a terminal failure is surfaced.
   */
  async runWithRetry<T>(
    fn: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    const delayFn = this.delayFn;
    const { maxAttempts } = TRACE_PERSIST_RETRY_POLICY;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await delayFn(jitteredDelayMs(attempt));
      }
      try {
        return { ok: true, value: await fn() };
      } catch (err) {
        lastError = err;
      }
    }
    return { ok: false, error: lastError };
  }

  /**
   * Claim the idempotency key by persisting a `running` trace BEFORE dispatch (D1).
   * - skipped: no key (or no store) -> legacy single-persist path.
   * - claimed: running claim persisted; caller must finalize via update().
   * - conflict: lost the race (P2002) -> caller fails closed.
   * - claim_failed: transient store error before any mutation -> caller returns retryable.
   */
  async claimIdempotency(
    traceStore: WorkTraceStore | undefined,
    workUnit: WorkUnit,
    decision: GovernanceDecision,
    governanceCompletedAt: string,
    executionStartedAt: string,
  ): Promise<{ kind: "skipped" | "claimed" | "conflict" | "claim_failed" }> {
    if (!traceStore || !workUnit.idempotencyKey) return { kind: "skipped" };
    const claimTrace = buildClaimTrace({
      workUnit,
      governanceDecision: decision,
      governanceCompletedAt,
      executionStartedAt,
    });
    const result = await this.runWithRetry(() => traceStore.claim(claimTrace));
    if (!result.ok) {
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: result.error,
        workUnit,
        retryable: true,
      });
      return { kind: "claim_failed" };
    }
    return result.value.claimed ? { kind: "claimed" } : { kind: "conflict" };
  }

  /**
   * Finalize a `running` claim by updating it to its terminal outcome. Never
   * throws: a terminal update failure leaves the running claim in place (a retry
   * then fails closed) and records an infra-failure. executionStartedAt is NOT
   * re-sent — it is ONE_SHOT and was sealed at claim time.
   */
  async finalizeTrace(
    traceStore: WorkTraceStore | undefined,
    workUnit: WorkUnit,
    executionResult: ExecutionResult,
    completedAt: string,
  ): Promise<void> {
    if (!traceStore) return;
    const result = await this.runWithRetry(() =>
      traceStore.update(
        workUnit.id,
        {
          outcome: executionResult.outcome,
          durationMs: executionResult.durationMs,
          executionSummary: executionResult.summary,
          executionOutputs: executionResult.outputs,
          error: executionResult.error,
          injectedPatternIds: executionResult.injectedPatternIds ?? [],
          completedAt,
        },
        { caller: "platform_ingress_finalize", organizationId: workUnit.organizationId },
      ),
    );
    if (!result.ok) {
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: result.error,
        workUnit,
        retryable: false,
      });
      return;
    }
    if (!result.value.ok) {
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: new Error(`finalize update rejected: ${result.value.reason}`),
        workUnit,
        retryable: false,
      });
    }
  }

  async recordInfrastructureFailure(input: {
    errorType: "governance_eval_exception" | "trace_persist_failed" | "execution_exception";
    error: unknown;
    workUnit?: WorkUnit;
    retryable: boolean;
  }): Promise<void> {
    const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
      errorType: input.errorType,
      error: input.error,
      workUnit: input.workUnit
        ? {
            id: input.workUnit.id,
            intent: input.workUnit.intent,
            traceId: input.workUnit.traceId,
            organizationId: input.workUnit.organizationId,
            deployment: input.workUnit.deployment
              ? { deploymentId: input.workUnit.deployment.deploymentId }
              : undefined,
          }
        : undefined,
      retryable: input.retryable,
    });

    if (this.auditLedger) {
      try {
        await this.auditLedger.record({
          ...ledgerParams,
          // Typed snapshot widened to ledger's generic Record<string, unknown> envelope.
          snapshot: ledgerParams.snapshot as unknown as Record<string, unknown>,
        });
      } catch (auditErr) {
        // Invariant: no recursive failure logging.
        console.error(
          "[PlatformIngress] failed to record infrastructure-failure audit entry",
          auditErr,
        );
      }
    }

    await safeAlert(this.alerter, alert);
  }
}
