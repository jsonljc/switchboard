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

function makeDeps(job: Record<string, unknown> | null) {
  return {
    jobStore: {
      findById: vi.fn(async (): Promise<unknown> => job),
      updatePublishFields: vi.fn(async (): Promise<unknown> => ({})),
    },
  };
}

// Dead-letter shape for creative.publish.failed: envelope + the trigger
// passthrough makeOnFailureHandler adds (the original publish.requested data).
const publishFailedEvent = {
  trigger: { jobId: "job_1", organizationId: "org_evt" },
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
    const deps = makeDeps({
      id: "job_1",
      organizationId: "org_1",
      metaPublishStatus: "parked_paused",
    });
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.jobStore.updatePublishFields).not.toHaveBeenCalled();
  });

  it("does not re-write a job already marked publish_failed (idempotent)", async () => {
    const deps = makeDeps({
      id: "job_1",
      organizationId: "org_1",
      metaPublishStatus: "publish_failed",
    });
    await executeCreativePublishFailureRecorder(publishFailedEvent, step, deps as never);
    expect(deps.jobStore.updatePublishFields).not.toHaveBeenCalled();
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
