// apps/api/src/services/cron/stranded-claim-reaper.ts
// ---------------------------------------------------------------------------
// EV-2 / SPINE-2 — stranded idempotency-claim reaper (Inngest cron)
// ---------------------------------------------------------------------------
// Hourly sweep that ages orphaned `running` ingress idempotency CLAIMS (a process
// death between PlatformIngress.claim() and finalizeTrace) to the terminal
// `needs_reconciliation` dead-letter sink, emitting a per-row counter and ONE
// operator alert per run. The block on the stranded key is deliberate (the mutation
// may have committed — Doctrine #6); this only adds the dead-letter + visibility, it
// NEVER re-opens a key. The actual aging/alert logic lives in the core
// `reapStrandedClaims` orchestrator; this file is the thin Inngest wiring.
//
// Schedule: top of every hour (`0 * * * *`). The reaper is idempotent across
// retries — an already-reaped row is `needs_reconciliation`, not `running`, so
// findStuckRunning will not return it again.
// ---------------------------------------------------------------------------

import {
  makeOnFailureHandler,
  type AsyncFailureContext,
  type OperatorAlerter,
  type Counter,
} from "@switchboard/core";
import {
  reapStrandedClaims,
  STRANDED_CLAIM_MAX_AGE_MS,
  STRANDED_CLAIM_REAP_LIMIT,
  type StrandedClaimReaperStore,
  type ReapStrandedClaimsResult,
} from "@switchboard/core/platform";
import { inngestClient } from "@switchboard/creative-pipeline";

export interface StrandedClaimReaperCronDeps {
  failure: AsyncFailureContext;
  /**
   * The WorkTrace store (PrismaWorkTraceStore satisfies the narrow reaper slice).
   * Null when no Postgres-backed store is wired — the cron then no-ops, never
   * fabricating a reaper run.
   */
  store: StrandedClaimReaperStore | null;
  alerter: OperatorAlerter;
  /** `strandedClaimReaped` from the active metrics registry. */
  counter: Counter;
  /** Defaults to STRANDED_CLAIM_MAX_AGE_MS. */
  olderThanMs?: number;
  /** Defaults to STRANDED_CLAIM_REAP_LIMIT. */
  limit?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export type StrandedClaimReaperResult = ReapStrandedClaimsResult & { skipped?: boolean };

export async function executeStrandedClaimReaper(
  step: StepTools,
  deps: StrandedClaimReaperCronDeps,
): Promise<StrandedClaimReaperResult> {
  const store = deps.store;
  if (!store) {
    // No store wired (no Postgres) — nothing to reap. Never alert.
    return { scanned: 0, reaped: 0, failed: 0, skipped: true };
  }
  return step.run("reap-stranded-claims", () =>
    reapStrandedClaims(
      { store, counter: deps.counter, alerter: deps.alerter, now: deps.now },
      {
        olderThanMs: deps.olderThanMs ?? STRANDED_CLAIM_MAX_AGE_MS,
        limit: deps.limit ?? STRANDED_CLAIM_REAP_LIMIT,
      },
    ),
  );
}

export function createStrandedClaimReaperCron(deps: StrandedClaimReaperCronDeps) {
  return inngestClient.createFunction(
    {
      id: "stranded-claim-reaper-hourly",
      name: "Stranded Idempotency-Claim Reaper",
      retries: 2,
      triggers: [{ cron: "0 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "stranded-claim-reaper-hourly",
          eventDomain: "stranded-claim-reaper",
          // A reaper run failing means stranded claims keep blocking keys silently — alert.
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => executeStrandedClaimReaper(step as unknown as StepTools, deps),
  );
}
