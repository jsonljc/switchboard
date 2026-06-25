import type { WorkTrace } from "./work-trace.js";
import type { StrandedRunningClaim, WorkTraceUpdateResult } from "./work-trace-recorder.js";
import type {
  OperatorAlerter,
  InfrastructureFailureAlert,
} from "../observability/operator-alerter.js";
import { safeAlert } from "../observability/operator-alerter.js";
import type { Counter } from "../telemetry/metrics.js";

/**
 * EV-2 / SPINE-2 — Stranded idempotency-claim reaper.
 *
 * A process death between PlatformIngress's `claim()` (a `running` WorkTrace
 * written BEFORE the domain mutation) and `finalizeTrace` leaves an orphaned
 * `running` claim that PERMANENTLY, non-retryably blocks every future submit of
 * its idempotency key (platform-ingress replay guard, Doctrine #6). That permanent
 * block is deliberate — the mutation may have committed, so the key must never
 * become re-runnable. The gap this closes is the missing DEAD-LETTER + operator
 * visibility: this bounded reaper ages such a claim to the terminal
 * `needs_reconciliation` sink (which seals the row, stamping lockedAt), emits a
 * counter, and surfaces ONE operator alert per run.
 *
 * It NEVER re-opens a key: `needs_reconciliation` is terminal and the replay guard
 * special-cases it to stay fail-closed. The only safe direction is "left for a
 * human to reconcile", not "auto-resubmitted".
 */

/**
 * The narrow slice of the WorkTrace store the reaper needs (find + age-out).
 * Deliberately NOT part of the `WorkTraceStore` interface: only the real
 * `PrismaWorkTraceStore` (and a purpose-built reaper fake) implement
 * `findStuckRunning`, so the dozens of inline `WorkTraceStore` mocks across the
 * suite are not forced to stub a method they never exercise. `PrismaWorkTraceStore`
 * satisfies this structurally.
 */
export interface StrandedClaimReaperStore {
  findStuckRunning(olderThan: Date, limit: number): Promise<StrandedRunningClaim[]>;
  update(
    workUnitId: string,
    fields: Partial<WorkTrace>,
    options?: { caller?: string; organizationId?: string },
  ): Promise<WorkTraceUpdateResult>;
}

export interface ReapStrandedClaimsDeps {
  store: StrandedClaimReaperStore;
  /** `strandedClaimReaped` — incremented once per row actually aged out, by intent. */
  counter: Counter;
  /** Fired ONCE per run (when ≥1 stranded claim is found) — no per-row alert storm. */
  alerter: OperatorAlerter;
  /** Injectable clock for tests; defaults to wall clock. */
  now?: () => Date;
}

export interface ReapStrandedClaimsConfig {
  /** Age threshold: only claims older than this are reaped. */
  olderThanMs: number;
  /** Upper bound on rows scanned/aged per run. */
  limit: number;
}

export interface ReapStrandedClaimsResult {
  /** Stranded claims found this run. */
  scanned: number;
  /** Claims successfully aged to needs_reconciliation. */
  reaped: number;
  /** Claims found but whose age-out write failed/threw (left as-is for next run). */
  failed: number;
}

/**
 * 30 minutes — well above any legitimate keyed dispatch (the `running` claim window
 * is a single synchronous dispatch that finalizes in seconds; a keyed workflow that
 * goes async finalizes running -> queued, not staying `running`). A claim still
 * `running` after this is stranded. Generous enough that a slow-but-live dispatch is
 * never falsely reaped; even if one were, the outcome is the SAFE direction
 * (needs_reconciliation + alert, never a double-apply).
 */
export const STRANDED_CLAIM_MAX_AGE_MS = 30 * 60 * 1000;

/** Bounded batch per run — the reaper never fans out unbounded on a mass outage. */
export const STRANDED_CLAIM_REAP_LIMIT = 500;

export async function reapStrandedClaims(
  deps: ReapStrandedClaimsDeps,
  config: ReapStrandedClaimsConfig,
): Promise<ReapStrandedClaimsResult> {
  const now = deps.now?.() ?? new Date();
  const olderThan = new Date(now.getTime() - config.olderThanMs);

  const stuck = await deps.store.findStuckRunning(olderThan, config.limit);
  let reaped = 0;
  let failed = 0;

  for (const claim of stuck) {
    try {
      const result = await deps.store.update(
        claim.workUnitId,
        {
          outcome: "needs_reconciliation",
          completedAt: now.toISOString(),
          error: {
            code: "STRANDED_CLAIM_REAPED",
            message:
              `Idempotency claim stranded in 'running' (no finalize) longer than ` +
              `${config.olderThanMs}ms; aged to needs_reconciliation. The prior mutation may ` +
              `have committed — manual reconciliation required; the key stays blocked.`,
          },
          executionSummary: "Stranded idempotency claim reaped to needs_reconciliation (EV-2)",
        },
        // Org-scoped (the #643 tenant tripwire) + caller-tagged for the audit trail.
        { caller: "stranded_claim_reaper", organizationId: claim.organizationId },
      );

      if (!result.ok) {
        failed++;
        console.error(
          `[stranded-claim-reaper] FAILED to reap workUnitId=${claim.workUnitId} ` +
            `org=${claim.organizationId} intent=${claim.intent} (${result.reason}); left for next run`,
        );
        continue;
      }

      reaped++;
      deps.counter.inc({ intent: claim.intent });
      // Per-row forensics so each blocked key is in logs (the alert is a summary).
      console.warn(
        `[stranded-claim-reaper] reaped stranded running claim workUnitId=${claim.workUnitId} ` +
          `org=${claim.organizationId} intent=${claim.intent} ` +
          `idempotencyKey=${claim.idempotencyKey ?? "?"} traceId=${claim.traceId} ` +
          `executionStartedAt=${claim.executionStartedAt ?? "?"} -> needs_reconciliation ` +
          `(key stays blocked; manual reconciliation required)`,
      );
    } catch (err) {
      failed++;
      console.error(
        `[stranded-claim-reaper] reap threw for workUnitId=${claim.workUnitId} ` +
          `org=${claim.organizationId} intent=${claim.intent}; left for next run`,
        err,
      );
    }
  }

  // ONE summary alert per run when ANY stranded claim was found (reaped or not) —
  // never silent, never a per-row storm. A reap-write failure escalates to critical
  // (a stranded claim we could not even dead-letter is the alarm case).
  if (stuck.length > 0) {
    const intents = [...new Set(stuck.map((c) => c.intent))].sort().join(", ");
    const alert: InfrastructureFailureAlert = {
      errorType: "stranded_claim_reaped",
      severity: failed > 0 ? "critical" : "warning",
      errorMessage:
        `Found ${stuck.length} stranded running idempotency claim(s); reaped ${reaped} to ` +
        `needs_reconciliation, ${failed} reap-write failure(s). Manual reconciliation required. ` +
        `Intents: ${intents}.`,
      retryable: false,
      occurredAt: now.toISOString(),
      source: "inngest_function",
    };
    await safeAlert(deps.alerter, alert);
  }

  return { scanned: stuck.length, reaped, failed };
}
