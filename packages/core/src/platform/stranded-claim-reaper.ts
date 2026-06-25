import type { WorkTrace } from "./work-trace.js";
import type { StrandedRunningClaim, WorkTraceUpdateResult } from "./work-trace-recorder.js";
import { WorkTraceLockedError } from "./work-trace-lock.js";
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
  /**
   * Claims a CONCURRENT writer terminalized between scan and our update (the store
   * rejected our write with WORK_TRACE_LOCKED): another reaper run aged it, or a
   * resurrected finalize sealed it to completed/failed. Benign — the row is already
   * properly terminal — so it does NOT escalate the alert.
   */
  raced: number;
  /** Claims whose age-out write THREW (a hard store error) — left for the next run; the alarm case. */
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
  let raced = 0;
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
        // The store rejected our write because the row is already locked — a
        // concurrent reaper, or a resurrected finalize, terminalized it between our
        // scan and update. The row is now properly terminal (needs_reconciliation, or
        // completed/failed if a finalize won the race); nothing more to do here and
        // NOT an alarm. Log + count as a benign race so the summary alert stays warning.
        raced++;
        console.warn(
          `[stranded-claim-reaper] workUnitId=${claim.workUnitId} org=${claim.organizationId} ` +
            `intent=${claim.intent} was already terminalized by a concurrent writer (${result.reason}); skipping`,
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
      // The store may signal a lock rejection EITHER as a `{ok:false}` return (prod)
      // OR by THROWING WorkTraceLockedError (non-prod — see PrismaWorkTraceStore.update's
      // NODE_ENV fork). Both are the SAME benign concurrent-seal race, so classify the
      // throw identically — otherwise the alert tier would be environment-dependent
      // (warning in prod, false-critical in staging) for an identical event.
      if (err instanceof WorkTraceLockedError) {
        raced++;
        console.warn(
          `[stranded-claim-reaper] workUnitId=${claim.workUnitId} org=${claim.organizationId} ` +
            `intent=${claim.intent} was already terminalized by a concurrent writer ` +
            `(WorkTraceLockedError); skipping`,
        );
        continue;
      }
      failed++;
      console.error(
        `[stranded-claim-reaper] reap threw for workUnitId=${claim.workUnitId} ` +
          `org=${claim.organizationId} intent=${claim.intent}; left for next run`,
        err,
      );
    }
  }

  // ONE summary alert per run when ANY stranded claim was found (reaped or not) —
  // never silent, never a per-row storm. Only a HARD reap-write error (a throw)
  // escalates to critical; a benign concurrent-seal race does not (the row resolved).
  if (stuck.length > 0) {
    const intents = [...new Set(stuck.map((c) => c.intent))].sort().join(", ");
    // The scan is bounded at `limit`; hitting it means more stranded claims likely
    // remain (drained ≤limit/run on subsequent runs) — say so, so a mass-strand
    // incident is never silently under-reported as exactly `limit`.
    const capped = stuck.length >= config.limit;
    const cappedNote = capped
      ? ` Result CAPPED at the ${config.limit}-row scan limit — more stranded claims likely remain; the next run will continue.`
      : "";
    const alert: InfrastructureFailureAlert = {
      errorType: "stranded_claim_reaped",
      severity: failed > 0 ? "critical" : "warning",
      errorMessage:
        `Found ${stuck.length} stranded running idempotency claim(s); reaped ${reaped} to ` +
        `needs_reconciliation, ${raced} already-terminalized by a concurrent writer, ` +
        `${failed} hard reap-write error(s). Manual reconciliation required. Intents: ${intents}.${cappedNote}`,
      retryable: false,
      occurredAt: now.toISOString(),
      source: "inngest_function",
    };
    await safeAlert(deps.alerter, alert);
  }

  return { scanned: stuck.length, reaped, raced, failed };
}
