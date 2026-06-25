import { Inngest } from "inngest";
import {
  runReallocationGuardrailMonitor,
  DEFAULT_BLAST_RADIUS_CONTRACT,
  type ReallocationGuardrailMonitorDeps,
  type PendingReallocation,
  type GuardrailMeasurement,
  type GuardrailBreach,
  type ReallocationMonitorOutcome,
} from "@switchboard/ad-optimizer";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import type { CanonicalSubmitRequest, SubmitWorkResponse } from "@switchboard/core/platform";
import type { PendingGuardrailReallocation } from "@switchboard/db";
import { buildRileyResetBudgetSubmitRequest } from "../workflows/riley-reset-budget-submit-request.js";

// Local Inngest client (mirrors riley-outcome-attribution.ts): all api function registrations share
// the single "switchboard" id and fan out to the one serve handler in bootstrap/inngest.ts.
const inngestClient = new Inngest({ id: "switchboard" });

export const REALLOCATION_GUARDRAIL_EVENT = "riley.reallocation.guardrail-check";

/** The window the monitor waits for before measuring: the LONGEST contract guardrail window, so every
 *  guardrail has post-move data. Both the dispatch (which orgs have work) and the worker (which rows)
 *  share it, so they agree on "the window has elapsed". */
export const MIN_GUARDRAIL_WINDOW_MS =
  Math.max(0, ...DEFAULT_BLAST_RADIUS_CONTRACT.guardrails.map((g) => g.windowHours)) *
  60 *
  60 *
  1000;

// ─────────────────────────────── rollback dispatch ───────────────────────────────

export interface ReallocationRollbackDispatchDeps {
  /** Submit the reset intent through PlatformIngress (the governed write path). */
  submitReset: (req: CanonicalSubmitRequest) => Promise<SubmitWorkResponse>;
  logger: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

/**
 * The monitor's `dispatchRollback`: build the reset submit-request from the breached reallocation and
 * submit it through ingress. The reset restores `plan.targetCents` (the captured prior). On a PARK
 * (the allow-only reset somehow hit a require_approval gate, a misconfig) this THROWS so the monitor's
 * per-item catch leaves the row unresolved (re-tried + alarmed) rather than falsely marking it rolled
 * back. A null submit-request (non-positive targetCents) is likewise a throw: the rollback did not
 * happen.
 */
export function buildReallocationRollbackDispatch(
  deps: ReallocationRollbackDispatchDeps,
): ReallocationGuardrailMonitorDeps["dispatchRollback"] {
  return async (
    r: PendingReallocation,
    plan: { targetCents: number; deltaCentsSigned: number },
    breach: GuardrailBreach,
  ) => {
    const req = buildRileyResetBudgetSubmitRequest({
      organizationId: r.organizationId,
      deploymentId: r.deploymentId,
      adAccountId: r.adAccountId,
      campaignId: r.campaignId,
      targetCents: plan.targetCents,
      rollbackOfWorkUnitId: r.executionWorkUnitId,
      breachMetric: breach.metric,
      breachReason: breach.reason,
    });
    if (!req) {
      deps.logger.error(
        `[reallocation-guardrail] rollback submit-request was null for ${r.executionWorkUnitId} (targetCents=${plan.targetCents}); cannot restore`,
      );
      throw new Error(`reset submit-request was null for ${r.executionWorkUnitId}`);
    }
    const response = await deps.submitReset(req);
    // The rollback succeeded ONLY on a clean synchronous `completed` execution. Anything else means
    // the budget was NOT restored, so THROW: the monitor's per-item catch then leaves the row
    // UNRESOLVED (re-measured + re-dispatched next pass, deduped at ingress via reset:<wu>) instead of
    // the caller falsely marking it rolled_back and abandoning a still-over-budget campaign. Mirrors
    // buildRileyPauseSubmitter's phantom-success branch order (the in-repo precedent).
    if (!response.ok) {
      deps.logger.error(
        `[reallocation-guardrail] reset submit error type=${response.error.type} for ${r.executionWorkUnitId}: ${response.error.message}`,
      );
      throw new Error(`reset submit failed (${response.error.type}) for ${r.executionWorkUnitId}`);
    }
    if ("approvalRequired" in response) {
      // The rollback must auto-execute; a park means the allow-only seed is missing/misconfigured.
      deps.logger.error(
        `[reallocation-guardrail] CRITICAL: reset parked instead of executing for ${r.executionWorkUnitId} (allow-only policy missing?); the rollback did not happen`,
      );
      throw new Error(`reset parked instead of executing for ${r.executionWorkUnitId}`);
    }
    if (response.result.outcome !== "completed") {
      // ok:true + a non-completed outcome = a governance deny or the reset executor returning
      // outcome:"failed" (Meta error, account/prior mismatch, post-write mismatch). The budget was
      // not restored.
      deps.logger.error(
        `[reallocation-guardrail] reset did NOT complete for ${r.executionWorkUnitId} (outcome=${response.result.outcome}); the rollback did not happen`,
      );
      throw new Error(
        `reset did not complete (outcome=${response.result.outcome}) for ${r.executionWorkUnitId}`,
      );
    }
  };
}

// ─────────────────────────── per-org monitor deps composition ───────────────────────────

export interface BuildMonitorDepsArgs {
  organizationId: string;
  /** The store's guardrail-queue reads + resolve (PrismaMetaMutationAttemptStore, structural). */
  store: {
    listPendingGuardrailForOrg: (
      organizationId: string,
      now: Date,
      minWindowMs: number,
    ) => Promise<PendingGuardrailReallocation[]>;
    markGuardrailOutcome: (args: {
      executionWorkUnitId: string;
      organizationId: string;
      outcome: ReallocationMonitorOutcome;
    }) => Promise<{ transitioned: boolean }>;
  };
  measure: (r: PendingReallocation) => Promise<GuardrailMeasurement>;
  dispatchRollback: ReallocationGuardrailMonitorDeps["dispatchRollback"];
  /** Record the monitor verdict metric (orgId + outcome). */
  recordOutcome: (organizationId: string, outcome: ReallocationMonitorOutcome) => void;
  /** Raise a critical alert (per-item monitor failure, or an unrestorable breach). */
  alertCritical: (message: string) => void | Promise<void>;
  now: () => Date;
}

/**
 * Compose the pure `runReallocationGuardrailMonitor` deps for ONE org from the app-layer primitives.
 * listPendingReallocations maps the store rows to PendingReallocation (contract =
 * DEFAULT_BLAST_RADIUS_CONTRACT in v1; per-org tuning is deferred), skipping any row missing a
 * deploymentId (a legacy/never-in-prod row the rollback could not attribute). resolveReallocation
 * records the verdict metric AND alerts on the unrestorable case (a real breach that could not be
 * undone). onMonitorFailure isolates one item's failure with a critical alert (the weekly-audit
 * pattern), so one bad row never starves the batch.
 */
export function buildReallocationGuardrailMonitorDeps(
  args: BuildMonitorDepsArgs,
): ReallocationGuardrailMonitorDeps {
  return {
    listPendingReallocations: async () => {
      const rows = await args.store.listPendingGuardrailForOrg(
        args.organizationId,
        args.now(),
        MIN_GUARDRAIL_WINDOW_MS,
      );
      const mapped: PendingReallocation[] = [];
      for (const row of rows) {
        if (!row.deploymentId) {
          await args.alertCritical(
            `[reallocation-guardrail] applied reallocation ${row.executionWorkUnitId} has no deploymentId; cannot monitor or roll back`,
          );
          continue;
        }
        mapped.push({
          executionWorkUnitId: row.executionWorkUnitId,
          deploymentId: row.deploymentId,
          organizationId: row.organizationId,
          adAccountId: row.adAccountId,
          campaignId: row.campaignId,
          observedPriorCents: row.observedPriorCents,
          appliedAt: row.appliedAt,
          contract: DEFAULT_BLAST_RADIUS_CONTRACT,
        });
      }
      return mapped;
    },
    measureGuardrails: args.measure,
    dispatchRollback: args.dispatchRollback,
    resolveReallocation: async (r, outcome) => {
      // Dispatch-then-resolve order is deliberate and the SAFE direction: a rollback that succeeded
      // but failed to mark (a DB blip) leaves the row applied/un-monitored, so the next pass
      // re-measures + re-dispatches the reset (deduped at ingress via reset:<wu>, returning the cached
      // completed result) and re-marks. Never adopt the inverse (mark-before-dispatch): that would
      // record rolled_back for a rollback that never ran.
      const { transitioned } = await args.store.markGuardrailOutcome({
        executionWorkUnitId: r.executionWorkUnitId,
        organizationId: r.organizationId,
        outcome,
      });
      // A concurrent pass already resolved (and counted) this row: do not double-count the verdict
      // metric or re-alert. First-writer-wins at the DB; the metric mirrors it.
      if (!transitioned) return;
      args.recordOutcome(r.organizationId, outcome);
      if (outcome === "rollback_unrestorable") {
        await args.alertCritical(
          `[reallocation-guardrail] breach for ${r.executionWorkUnitId} could NOT be rolled back (unrestorable prior); manual reconciliation required`,
        );
      }
    },
    onMonitorFailure: async (r, err) => {
      await args.alertCritical(
        `[reallocation-guardrail] monitor failed for ${r.executionWorkUnitId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  };
}

// ─────────────────────────────── dispatch cron ───────────────────────────────

export interface ReallocationGuardrailDispatchDeps {
  /** Orgs with at least one applied, un-monitored, window-elapsed reallocation. */
  listOrgsWithPending: () => Promise<string[]>;
  sendEvent: (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;
}

export async function executeReallocationGuardrailDispatch(
  deps: ReallocationGuardrailDispatchDeps,
): Promise<{ dispatched: number }> {
  const orgs = await deps.listOrgsWithPending();
  for (const orgId of orgs) {
    await deps.sendEvent({ name: REALLOCATION_GUARDRAIL_EVENT, data: { orgId } });
  }
  return { dispatched: orgs.length };
}

/**
 * Daily dispatch cron. ALWAYS registered, NO enable flag: it is a safety monitor that must run
 * whenever a reallocation can be applied, and it is inert without applied reallocations
 * (listOrgsWithPending returns []), so a daily pass over zero orgs is a no-op. It only ever leads to a
 * rollback for a campaign that was reallocated, which requires the reallocate canary to have been on.
 */
export function createReallocationGuardrailDispatch(
  deps: ReallocationGuardrailDispatchDeps,
  onFailure?: (arg: unknown) => Promise<void>,
) {
  return inngestClient.createFunction(
    {
      id: "riley-reallocation-guardrail-dispatch",
      name: "Riley Reallocation Guardrail Monitor Dispatch",
      retries: 2,
      triggers: [{ cron: "0 8 * * *" }],
      ...(onFailure ? { onFailure } : {}),
    },
    async () => executeReallocationGuardrailDispatch(deps),
  );
}

// ─────────────────────────────── per-org worker ───────────────────────────────

export interface ReallocationGuardrailWorkerDeps {
  failure: AsyncFailureContext;
  /** Build the pure monitor deps for one org (buildReallocationGuardrailMonitorDeps in prod). */
  buildMonitorDeps: (organizationId: string) => ReallocationGuardrailMonitorDeps;
  logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export async function executeReallocationGuardrailWorker(
  deps: ReallocationGuardrailWorkerDeps,
  event: { data: unknown; name: string },
): Promise<{ orgId: string } | { skipped: "missing_org" }> {
  const orgId = (event.data as { orgId?: string } | undefined)?.orgId;
  if (!orgId) {
    deps.logger.error({ msg: "reallocation-guardrail: missing orgId in event payload" });
    throw new Error("missing orgId");
  }
  await runReallocationGuardrailMonitor(deps.buildMonitorDeps(orgId));
  deps.logger.info({ msg: "reallocation-guardrail-monitor-pass", orgId });
  return { orgId };
}

/**
 * Per-org worker. retries=2, and a CRITICAL onFailure (riskCategory "high", alert true): a monitor
 * that cannot run is a safety failure, not a benign skip. Per-item failures inside the pass are
 * isolated by the pure orchestrator's try/catch (onMonitorFailure), so this onFailure covers only a
 * total worker abort.
 */
export function createReallocationGuardrailWorker(deps: ReallocationGuardrailWorkerDeps) {
  return inngestClient.createFunction(
    {
      id: "riley-reallocation-guardrail-worker",
      retries: 2,
      triggers: [{ event: REALLOCATION_GUARDRAIL_EVENT }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "riley-reallocation-guardrail-worker",
          eventDomain: "riley.reallocation-guardrail",
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ event }) => executeReallocationGuardrailWorker(deps, event),
  );
}
