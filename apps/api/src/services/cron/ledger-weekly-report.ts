// apps/api/src/services/cron/ledger-weekly-report.ts
// ---------------------------------------------------------------------------
// Ledger-lite weekly owner-report delivery (slice 2). Dispatch + worker, modeled
// on mira-self-brief.ts: the Monday cron fans out one scan event per active org;
// the per-org worker submits a governed ledger.deliver_weekly_report through
// PlatformIngress, idempotency-keyed on the UTC ISO week (so an inngest retry
// replays the claim instead of re-sending). Every expected exit is a NAMED
// outcome in the run history; a thrown infra error rides the retry + onFailure.
//
// Kill-switch: LEDGER_WEEKLY_REPORT_ENABLED === "true" (default off). The
// dispatch always fires; the worker short-circuits when dark (the attribution
// pattern). Low-risk Class-E failure contract: no domain event, no alert.
// ---------------------------------------------------------------------------
import { Inngest } from "inngest";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import { isoWeekKey } from "../workflows/mira-self-brief-request.js";

// Shares the single "switchboard" Inngest id; fans out to the serve handler in
// bootstrap/inngest.ts.
const inngestClient = new Inngest({ id: "switchboard" });

export const WEEKLY_REPORT_DISPATCH_EVENT = "ledger/weekly-report.scan";

// ── Dispatch ──

export interface LedgerWeeklyReportDispatchDeps {
  /** Distinct orgs with an ACTIVE agent deployment (the weekly-report audience). */
  listActiveOrganizations: () => Promise<string[]>;
  /** Bound to inngestClient.send in apps/api. */
  sendEvent: (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;
}

interface DispatchStepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export async function executeLedgerWeeklyReportDispatch(
  step: DispatchStepTools,
  deps: LedgerWeeklyReportDispatchDeps,
): Promise<{ dispatched: number }> {
  const orgs = await step.run("list-active-orgs", () => deps.listActiveOrganizations());
  for (const organizationId of orgs) {
    await step.run(`emit-${organizationId}`, async () => {
      await deps.sendEvent({ name: WEEKLY_REPORT_DISPATCH_EVENT, data: { organizationId } });
    });
  }
  return { dispatched: orgs.length };
}

/**
 * Weekly dispatch cron, Mondays 13:00 UTC (after the Monday 10:00 Mira dispatch
 * and the earlier weekly audits, so the week's data is settled). Read-only; the
 * per-org worker owns the kill-switch.
 */
export function createLedgerWeeklyReportDispatch(
  deps: LedgerWeeklyReportDispatchDeps,
  onFailure?: (arg: unknown) => Promise<void>,
) {
  return inngestClient.createFunction(
    {
      id: "ledger-weekly-report-dispatch",
      name: "Ledger Weekly Report Dispatch",
      retries: 2,
      triggers: [{ cron: "0 13 * * 1" }],
      ...(onFailure ? { onFailure } : {}),
    },
    async ({ step }) =>
      executeLedgerWeeklyReportDispatch(step as unknown as DispatchStepTools, deps),
  );
}

// ── Worker ──

export interface LedgerWeeklyReportWorkerDeps {
  /** Read per invocation: LEDGER_WEEKLY_REPORT_ENABLED === "true". */
  readEnabledFlag: () => boolean;
  /** Submit the governed delivery intent through PlatformIngress. */
  submit: (input: {
    organizationId: string;
    idempotencyKey: string;
  }) => Promise<SubmitWorkResponse>;
  warn: (msg: string) => void;
  /** Optional clock for deterministic testing. */
  now?: () => Date;
}

export type LedgerWeeklyReportOutcome = { skipped: string; detail?: string } | { jobId: string };

/**
 * Per-org weekly scan: short-circuit when dark, else submit the delivery intent.
 * The idempotency key is the UTC ISO week, so at most one delivery per org per
 * week exists by construction and a retried run replays the claim.
 */
export async function executeLedgerWeeklyReportScan(
  deps: LedgerWeeklyReportWorkerDeps,
  organizationId: string,
): Promise<LedgerWeeklyReportOutcome> {
  if (!deps.readEnabledFlag()) return { skipped: "disabled" };

  const now = deps.now?.() ?? new Date();
  // Key uses the CURRENT (run) ISO week so each Monday fire is one unique claim; the report content
  // itself covers the just-completed prior week (completedWeekRange). At most one delivery per run week.
  const week = isoWeekKey(now);
  const response = await deps.submit({
    organizationId,
    idempotencyKey: `ledger-weekly-report:${organizationId}:${week}`,
  });

  if (!response.ok) {
    const type = response.error.type;
    // Org unentitled: keep "silent because unentitled" operator-visible, not swallowed.
    if (type === "entitlement_required") return { skipped: "org_not_entitled" };
    // A prior crashed attempt left a running claim; the weekly key self-heals next ISO week.
    if (type === "idempotency_in_flight") return { skipped: "claim_unresolved" };
    deps.warn(`[ledger-weekly-report] submit failed for ${organizationId}: ${type}`);
    return { skipped: "submit_failed", detail: type };
  }

  if ("approvalRequired" in response && response.approvalRequired) {
    // A future org policy could park delivery; a parked submit must not report success.
    deps.warn(`[ledger-weekly-report] delivery parked for ${organizationId}`);
    return { skipped: "parked" };
  }

  if (response.result.outcome !== "completed") {
    // not_configured / send_failed surface here as a failed outcome.
    deps.warn(
      `[ledger-weekly-report] delivery outcome ${response.result.outcome} for ${organizationId}`,
    );
    return { skipped: "delivery_failed", detail: response.result.outcome };
  }

  return { jobId: response.workUnit.id };
}

const LEDGER_WEEKLY_REPORT_WORKER_FAILURE_PARAMS = {
  functionId: "ledger-weekly-report-worker",
  eventDomain: "ledger.weekly_report",
  riskCategory: "low",
  alert: false,
  emitEvent: false,
} as const;

/**
 * Per-org scan worker. Triggered by WEEKLY_REPORT_DISPATCH_EVENT. Class-E failure
 * contract (audit always, no domain event, no alert): the next weekly run
 * self-heals. No internal step.run: the submit is idempotency-keyed, so a
 * whole-function retry replays the claim instead of duplicating work.
 */
export function createLedgerWeeklyReportWorker(
  deps: LedgerWeeklyReportWorkerDeps & { failure: AsyncFailureContext },
) {
  return inngestClient.createFunction(
    {
      id: "ledger-weekly-report-worker",
      name: "Ledger Weekly Report Worker",
      retries: 2,
      triggers: [{ event: WEEKLY_REPORT_DISPATCH_EVENT }],
      onFailure: makeOnFailureHandler(LEDGER_WEEKLY_REPORT_WORKER_FAILURE_PARAMS, deps.failure) as (
        arg: unknown,
      ) => Promise<void>,
    },
    async ({ event }) =>
      executeLedgerWeeklyReportScan(
        deps,
        (event.data as { organizationId: string }).organizationId,
      ),
  );
}
