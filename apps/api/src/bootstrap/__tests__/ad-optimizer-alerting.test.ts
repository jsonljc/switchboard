// apps/api/src/bootstrap/__tests__/ad-optimizer-alerting.test.ts
// PR 1.4b (D2-9 / D9-3): the weekly + signal-health ad-optimizer crons must fire
// the OperatorAlerter on exhausted retries (alert:true), and a successful-but-empty
// weekly audit must raise exactly one warning alert (zero-output signal). Driving
// the extracted helpers end-to-end is stronger than a config snapshot: it proves
// the alert:false -> true flip actually reaches safeAlert.
import { describe, it, expect, vi } from "vitest";
import type {
  AsyncFailureContext,
  InfrastructureFailureAlert,
  OperatorAlerter,
} from "@switchboard/core";
import {
  buildAdOptimizerFailureHandlers,
  buildSaveAuditReport,
  type SaveAuditReportDeps,
} from "../ad-optimizer-failure-handlers.js";

// Typed alerter spy: an untyped vi.fn() makes mock.calls an empty tuple under
// tsc-over-tests, reddening the api/chat BUILD (feedback_vitest_untyped_fn).
function makeAlerter(): { alert: ReturnType<typeof vi.fn> } & OperatorAlerter {
  const alert = vi.fn(async (_payload: InfrastructureFailureAlert): Promise<void> => undefined);
  return { alert } as { alert: ReturnType<typeof vi.fn> } & OperatorAlerter;
}

function makeAsyncFailure(operatorAlerter: OperatorAlerter): AsyncFailureContext {
  return {
    // The audit-ledger record + .failed emit are best-effort and wrapped in
    // try/catch inside makeOnFailureHandler; stub them so we isolate the alert leg.
    auditLedger: { record: vi.fn().mockResolvedValue(undefined) } as never,
    operatorAlerter,
    inngest: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("buildAdOptimizerFailureHandlers — alert-flip (D2-9 / D9-3)", () => {
  it("weekly cron alerts on failure (alert:true reaches safeAlert)", async () => {
    const alerter = makeAlerter();
    const handlers = buildAdOptimizerFailureHandlers(makeAsyncFailure(alerter));

    await handlers.weekly({ error: new Error("boom"), event: { data: { run_id: "r1" } } });

    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(alerter.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: "async_job_retry_exhausted",
        severity: "critical",
        source: "inngest_function",
      }),
    );
  });

  it("signal-health cron alerts on failure (alert:true reaches safeAlert)", async () => {
    const alerter = makeAlerter();
    const handlers = buildAdOptimizerFailureHandlers(makeAsyncFailure(alerter));

    await handlers.signalHealth({ error: new Error("boom"), event: { data: { run_id: "r2" } } });

    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(alerter.alert).toHaveBeenCalledWith(
      expect.objectContaining({ errorType: "async_job_retry_exhausted", severity: "critical" }),
    );
  });

  it("daily-check cron does NOT alert on failure (low-risk, self-heals next day)", async () => {
    const alerter = makeAlerter();
    const handlers = buildAdOptimizerFailureHandlers(makeAsyncFailure(alerter));

    await handlers.daily({ error: new Error("boom"), event: { data: { run_id: "r3" } } });

    expect(alerter.alert).not.toHaveBeenCalled();
  });
});

function stubDeploymentStore(): SaveAuditReportDeps["deploymentStore"] {
  return {
    findById: vi
      .fn()
      .mockResolvedValue({ id: "dep-1", organizationId: "org-1", listingId: "listing-1" }),
  };
}

function stubTaskStore(): SaveAuditReportDeps["taskStore"] {
  return {
    create: vi.fn().mockResolvedValue({ id: "task-1" }),
    submitOutput: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };
}

describe("buildSaveAuditReport — zero-output alert (D2-9)", () => {
  it("raises ONE operator alert when a successful audit produces zero recs AND zero insights", async () => {
    const alerter = makeAlerter();
    const taskStore = stubTaskStore();
    const save = buildSaveAuditReport({
      deploymentStore: stubDeploymentStore(),
      taskStore,
      operatorAlerter: alerter,
    });

    await save("dep-1", { accountId: "act_1", insights: [], watches: [], recommendations: [] });

    // The report is still persisted + marked completed (a zero-output run is a
    // signal, not a failure).
    expect(taskStore.updateStatus).toHaveBeenCalledWith("org-1", "task-1", "completed");
    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(alerter.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        errorType: "async_job_retry_exhausted",
        deploymentId: "dep-1",
      }),
    );
  });

  it("does NOT alert when the audit produced recommendations", async () => {
    const alerter = makeAlerter();
    const save = buildSaveAuditReport({
      deploymentStore: stubDeploymentStore(),
      taskStore: stubTaskStore(),
      operatorAlerter: alerter,
    });

    await save("dep-1", {
      accountId: "act_1",
      insights: [],
      watches: [],
      recommendations: [{ type: "scale_budget" }],
    });

    expect(alerter.alert).not.toHaveBeenCalled();
  });

  it("does NOT alert when the audit produced an abstention insight (recs=0 but insights>0)", async () => {
    const alerter = makeAlerter();
    const save = buildSaveAuditReport({
      deploymentStore: stubDeploymentStore(),
      taskStore: stubTaskStore(),
      operatorAlerter: alerter,
    });

    await save("dep-1", {
      accountId: "act_1",
      insights: [{ title: "Coverage below floor; abstaining." }],
      watches: [],
      recommendations: [],
    });

    expect(alerter.alert).not.toHaveBeenCalled();
  });

  it("skips persistence and never alerts when the deployment is not found", async () => {
    const alerter = makeAlerter();
    const taskStore = stubTaskStore();
    const save = buildSaveAuditReport({
      deploymentStore: { findById: vi.fn().mockResolvedValue(null) },
      taskStore,
      operatorAlerter: alerter,
    });

    await save("dep-missing", {
      accountId: "act_1",
      insights: [],
      watches: [],
      recommendations: [],
    });

    expect(taskStore.create).not.toHaveBeenCalled();
    expect(alerter.alert).not.toHaveBeenCalled();
  });
});
