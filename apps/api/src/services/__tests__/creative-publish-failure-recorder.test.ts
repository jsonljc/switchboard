import { describe, it, expect, vi } from "vitest";

const { inngestCreateFunction } = vi.hoisted(() => ({
  inngestCreateFunction: vi.fn((_cfg: unknown, _handler: unknown) => ({
    id: "creative-publish-failure-recorder",
  })),
}));
vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { createFunction: inngestCreateFunction },
}));

const { executeCreativePublishFailureRecorder, CREATIVE_PUBLISH_FAILURE_RECORDER_FAILURE_PARAMS } =
  await import("../creative-publish-failure-recorder.js");

/** step.run mock: invokes the callback and returns its value (no Inngest memoization). */
const step = { run: async (_id: string, fn: () => unknown) => fn() } as never;

type TraceShape = {
  outcome: string;
  organizationId?: string;
  intent?: string;
  parameters?: Record<string, unknown>;
};

const QUEUED_PUBLISH_TRACE: TraceShape = {
  outcome: "queued",
  organizationId: "org_1",
  intent: "creative.job.publish",
  parameters: { jobId: "job_1" },
};

function makeDeps(
  job: Record<string, unknown> | null,
  trace: TraceShape | null = QUEUED_PUBLISH_TRACE,
) {
  return {
    jobStore: {
      findById: vi.fn(async (): Promise<unknown> => job),
      updatePublishFields: vi.fn(async (): Promise<unknown> => ({})),
    },
    traceStore: {
      getByWorkUnitId: vi.fn(
        async (): Promise<unknown> => (trace ? { trace, integrity: { status: "ok" } } : null),
      ),
      update: vi.fn(
        async (): Promise<unknown> => ({
          ok: true,
          trace: { ...(trace ?? {}), outcome: "failed" },
        }),
      ),
    },
  };
}

// Dead-letter shape for creative.publish.failed: envelope + the trigger
// passthrough makeOnFailureHandler adds (the original publish.requested data,
// now including the originating workUnitId).
const publishFailedEvent = {
  trigger: { jobId: "job_1", organizationId: "org_evt", workUnitId: "wu_1" },
  code: "CREATIVE_PUBLISH_META_ERROR",
  message: "Graph API 400: invalid page id",
  functionId: "creative-publish",
  occurredAt: "2026-06-12T00:00:00.000Z",
};

describe("executeCreativePublishFailureRecorder", () => {
  it("marks metaPublishStatus publish_failed using the loaded job's org, never the event's", async () => {
    const deps = makeDeps({ id: "job_1", organizationId: "org_1", metaPublishStatus: null });
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.jobStore.updatePublishFields).toHaveBeenCalledWith("org_1", "job_1", {
      metaPublishStatus: "publish_failed",
    });
  });

  it("skips when the dead-letter carries no jobId", async () => {
    const deps = makeDeps(null);
    await executeCreativePublishFailureRecorder({ code: "X" }, step, deps as never);
    expect(deps.jobStore.findById).not.toHaveBeenCalled();
    expect(deps.jobStore.updatePublishFields).not.toHaveBeenCalled();
  });

  it("skips when the job is not found", async () => {
    const deps = makeDeps(null);
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.jobStore.updatePublishFields).not.toHaveBeenCalled();
  });

  it("does not clobber a job that already parked the paused draft (success)", async () => {
    // Stale `.failed` from an earlier attempt after a later attempt parked: the
    // job field stays success; this attempt's trace is already terminal -> no-op.
    const deps = makeDeps(
      { id: "job_1", organizationId: "org_1", metaPublishStatus: "parked_paused" },
      {
        outcome: "failed",
        organizationId: "org_1",
        intent: "creative.job.publish",
        parameters: { jobId: "job_1" },
      },
    );
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.jobStore.updatePublishFields).not.toHaveBeenCalled();
    expect(deps.traceStore.update).not.toHaveBeenCalled();
  });

  it("reconciles the queued publish trace to failed, org-scoped from the job", async () => {
    const deps = makeDeps({ id: "job_1", organizationId: "org_1", metaPublishStatus: null });
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.traceStore.getByWorkUnitId).toHaveBeenCalledWith("wu_1");
    expect(deps.traceStore.update).toHaveBeenCalledWith(
      "wu_1",
      expect.objectContaining({
        outcome: "failed",
        error: { code: "CREATIVE_PUBLISH_META_ERROR", message: "Graph API 400: invalid page id" },
        executionSummary: expect.stringContaining("failed"),
        completedAt: "2026-06-12T00:00:00.000Z",
      }),
      { caller: "creative-publish-failure-recorder", organizationId: "org_1" },
    );
  });

  it("reconciles the trace even when the job is already publish_failed (no queued lie)", async () => {
    // Must-fix 2: the job-state idempotency guard must NOT suppress trace reconciliation.
    const deps = makeDeps({
      id: "job_1",
      organizationId: "org_1",
      metaPublishStatus: "publish_failed",
    });
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.jobStore.updatePublishFields).not.toHaveBeenCalled(); // job mark skipped (resolved)
    expect(deps.traceStore.update).toHaveBeenCalledWith(
      "wu_1",
      expect.objectContaining({ outcome: "failed" }),
      expect.objectContaining({ organizationId: "org_1" }),
    );
  });

  it("refuses a cross-tenant reconcile when the trace org != the job org", async () => {
    const deps = makeDeps(
      { id: "job_1", organizationId: "org_1", metaPublishStatus: null },
      {
        outcome: "queued",
        organizationId: "org_B",
        intent: "creative.job.publish",
        parameters: { jobId: "job_1" },
      },
    );
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.traceStore.update).not.toHaveBeenCalled();
  });

  it("refuses a wrong-action reconcile when the trace intent != creative.job.publish", async () => {
    const deps = makeDeps(
      { id: "job_1", organizationId: "org_1", metaPublishStatus: null },
      {
        outcome: "queued",
        organizationId: "org_1",
        intent: "creative.job.submit",
        parameters: { jobId: "job_1" },
      },
    );
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.traceStore.update).not.toHaveBeenCalled();
  });

  it("refuses a wrong-job reconcile when the trace parameters.jobId != the loaded job", async () => {
    const deps = makeDeps(
      { id: "job_1", organizationId: "org_1", metaPublishStatus: null },
      {
        outcome: "queued",
        organizationId: "org_1",
        intent: "creative.job.publish",
        parameters: { jobId: "job_other" },
      },
    );
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.traceStore.update).not.toHaveBeenCalled();
  });

  it("no-ops the trace reconcile when the trace already reached a terminal outcome", async () => {
    const deps = makeDeps(
      { id: "job_1", organizationId: "org_1", metaPublishStatus: null },
      {
        outcome: "completed",
        organizationId: "org_1",
        intent: "creative.job.publish",
        parameters: { jobId: "job_1" },
      },
    );
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.traceStore.update).not.toHaveBeenCalled();
  });

  it("warns and no-ops when the WorkTrace is missing", async () => {
    const deps = makeDeps({ id: "job_1", organizationId: "org_1", metaPublishStatus: null }, null);
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.traceStore.getByWorkUnitId).toHaveBeenCalledWith("wu_1");
    expect(deps.traceStore.update).not.toHaveBeenCalled();
  });

  it("tolerates a locked trace, production shape ({ ok: false }), without throwing", async () => {
    const deps = makeDeps({ id: "job_1", organizationId: "org_1", metaPublishStatus: null });
    deps.traceStore.update = vi.fn(async () => ({
      ok: false,
      code: "WORK_TRACE_LOCKED",
      traceUnchanged: true,
      reason: "locked",
    }));
    await expect(
      executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never),
    ).resolves.toBeUndefined();
  });

  it("tolerates a locked trace, non-production shape (WorkTraceLockedError throw), without escaping", async () => {
    const deps = makeDeps({ id: "job_1", organizationId: "org_1", metaPublishStatus: null });
    deps.traceStore.update = vi.fn(async () => {
      throw Object.assign(new Error("Trace locked"), { code: "WORK_TRACE_LOCKED" });
    });
    await expect(
      executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never),
    ).resolves.toBeUndefined();
  });

  it("propagates an unexpected trace-store error so Inngest can retry", async () => {
    const deps = makeDeps({ id: "job_1", organizationId: "org_1", metaPublishStatus: null });
    deps.traceStore.update = vi.fn(async () => {
      throw new Error("connection reset");
    });
    await expect(
      executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never),
    ).rejects.toThrow("connection reset");
  });

  it("skips the trace reconcile (job-only honesty) when the dead-letter carries no workUnitId", async () => {
    const deps = makeDeps({ id: "job_1", organizationId: "org_1", metaPublishStatus: null });
    const eventNoWu = {
      ...publishFailedEvent,
      trigger: { jobId: "job_1", organizationId: "org_evt" },
    };
    await executeCreativePublishFailureRecorder(eventNoWu, step, deps as never);
    expect(deps.jobStore.updatePublishFields).toHaveBeenCalled();
    expect(deps.traceStore.getByWorkUnitId).not.toHaveBeenCalled();
    expect(deps.traceStore.update).not.toHaveBeenCalled();
  });

  it("degrades to job-only honesty when no trace store is wired", async () => {
    const deps = makeDeps({ id: "job_1", organizationId: "org_1", metaPublishStatus: null });
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, {
      jobStore: deps.jobStore,
      traceStore: null,
    } as never);
    expect(deps.jobStore.updatePublishFields).toHaveBeenCalled();
  });
});

describe("CREATIVE_PUBLISH_FAILURE_RECORDER_FAILURE_PARAMS", () => {
  it("is a Class-E contract: audit-only, no event recursion, no alert", () => {
    expect(CREATIVE_PUBLISH_FAILURE_RECORDER_FAILURE_PARAMS).toMatchObject({
      functionId: "creative-publish-failure-recorder",
      alert: false,
      emitEvent: false,
    });
  });
});
