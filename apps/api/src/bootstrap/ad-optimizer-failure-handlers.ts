// apps/api/src/bootstrap/ad-optimizer-failure-handlers.ts
//
// PR 1.4b (D2-9 / D9-3). Extracted from bootstrap/inngest.ts so the ad-optimizer
// failure-alert wiring is unit-testable end-to-end (driving makeOnFailureHandler
// and safeAlert), not just snapshot-able.
//
// Two concerns:
//   1. buildAdOptimizerFailureHandlers — the weekly + signal-health crons now
//      alert on exhausted retries (alert:true); the daily account-summary check
//      stays alert:false (Class E, low-risk, self-heals next day).
//   2. buildSaveAuditReport — persists the weekly audit report and raises ONE
//      warning alert when a SUCCESSFUL run produced zero recommendations AND zero
//      insights (a genuinely empty run; an abstention carries >=1 explanatory
//      insight and is correctly NOT flagged).
import {
  makeOnFailureHandler,
  safeAlert,
  type AsyncFailureContext,
  type OperatorAlerter,
} from "@switchboard/core";

// The Inngest onFailure arg shape the handlers accept (mirrors
// async-failure-handler's internal InngestOnFailureArg; kept structural so this
// module does not depend on Inngest SDK types).
interface OnFailureArg {
  error: unknown;
  event?: { data?: { run_id?: string; event?: { name?: string; data?: Record<string, unknown> } } };
}

export type OnFailureHandler = (arg: OnFailureArg) => Promise<void>;

export interface AdOptimizerFailureHandlers {
  weekly: OnFailureHandler;
  daily: OnFailureHandler;
  signalHealth: OnFailureHandler;
}

/**
 * Build the three ad-optimizer cron onFailure handlers. D2-9 / D9-3: the weekly
 * audit and daily signal-health crons alert on exhausted retries; the daily
 * account-summary check does NOT (it is low-risk and self-heals on the next
 * day's run, so paging an operator would be noise).
 */
export function buildAdOptimizerFailureHandlers(
  asyncFailure: AsyncFailureContext,
): AdOptimizerFailureHandlers {
  const weekly = makeOnFailureHandler(
    {
      functionId: "ad-optimizer-weekly-audit",
      eventDomain: "ad-optimizer.weekly-audit",
      riskCategory: "medium",
      // D2-9 / D9-3 flip: a weekly audit that exhausts retries is an org going
      // un-optimized for a week — page the operator.
      alert: true,
    },
    asyncFailure,
  ) as OnFailureHandler;

  const daily = makeOnFailureHandler(
    {
      functionId: "ad-optimizer-daily-check",
      riskCategory: "low",
      // Intentionally NOT flipped: the daily account-summary ping is Class E and
      // self-heals on the next day's run, so a single exhausted run is not worth
      // an operator page. The audit-ledger record (always written) keeps it visible.
      alert: false,
      emitEvent: false,
    },
    asyncFailure,
  ) as OnFailureHandler;

  const signalHealth = makeOnFailureHandler(
    {
      functionId: "ad-optimizer-daily-signal-health",
      eventDomain: "ad-optimizer.signal-health",
      riskCategory: "medium",
      // D2-9 / D9-3 flip: exhausted signal-health means pixel/CAPI breaches go
      // undetected — alert so an operator can look before the daily pipeline runs.
      alert: true,
    },
    asyncFailure,
  ) as OnFailureHandler;

  return { weekly, daily, signalHealth };
}

// ── saveAuditReport (with zero-output alert) ───────────────────────────────────

/** Minimal structural deployment-store surface saveAuditReport needs. */
interface SaveAuditReportDeploymentStore {
  findById(id: string): Promise<{ id: string; organizationId: string; listingId: string } | null>;
}

/** Minimal structural task-store surface saveAuditReport needs. */
interface SaveAuditReportTaskStore {
  create(input: {
    deploymentId: string;
    organizationId: string;
    listingId: string;
    category: string;
    input: Record<string, unknown>;
  }): Promise<{ id: string }>;
  submitOutput(
    organizationId: string,
    id: string,
    output: Record<string, unknown>,
  ): Promise<unknown>;
  updateStatus(organizationId: string, id: string, status: string): Promise<unknown>;
}

export interface SaveAuditReportDeps {
  deploymentStore: SaveAuditReportDeploymentStore;
  taskStore: SaveAuditReportTaskStore;
  operatorAlerter: OperatorAlerter;
}

// The fields of the weekly audit report saveAuditReport inspects for the
// zero-output signal. The report carries more (summary/funnel/etc.); only the
// two arrays are load-bearing here.
interface AuditReportShape {
  insights?: unknown[];
  recommendations?: unknown[];
}

/**
 * Build the weekly-audit saveAuditReport callback. Persists the report as a
 * completed audit task, then — for a SUCCESSFUL run that produced zero
 * recommendations AND zero insights (a genuinely empty run, not an abstention,
 * which carries >=1 explanatory insight) — raises exactly one warning operator
 * alert so a silently-empty audit is not silence. The alert is severity:"warning"
 * (a zero-output run is a signal, not a page) and never blocks persistence.
 */
export function buildSaveAuditReport(
  deps: SaveAuditReportDeps,
): (deploymentId: string, report: unknown) => Promise<void> {
  return async (deploymentId, report) => {
    const deployment = await deps.deploymentStore.findById(deploymentId);
    if (!deployment) return;
    const task = await deps.taskStore.create({
      deploymentId,
      organizationId: deployment.organizationId,
      listingId: deployment.listingId,
      category: "audit",
      input: {},
    });
    await deps.taskStore.submitOutput(
      deployment.organizationId,
      task.id,
      report as Record<string, unknown>,
    );
    await deps.taskStore.updateStatus(deployment.organizationId, task.id, "completed");

    const shape = (report ?? {}) as AuditReportShape;
    const recCount = Array.isArray(shape.recommendations) ? shape.recommendations.length : 0;
    const insightCount = Array.isArray(shape.insights) ? shape.insights.length : 0;
    if (recCount === 0 && insightCount === 0) {
      await safeAlert(deps.operatorAlerter, {
        errorType: "async_job_retry_exhausted",
        severity: "warning",
        errorMessage: `ad-optimizer weekly audit for dep ${deploymentId} produced zero output (no recommendations, no insights)`,
        retryable: false,
        occurredAt: new Date().toISOString(),
        source: "inngest_function",
        deploymentId,
        organizationId: deployment.organizationId,
      });
    }
  };
}
