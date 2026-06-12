import { describe, it, expect } from "vitest";
import { buildAsyncFailureEnvelope, makeOnFailureHandler } from "../async-failure-handler.js";
import type { AuditLedger } from "../../audit/ledger.js";
import type { OperatorAlerter } from "../operator-alerter.js";

describe("buildAsyncFailureEnvelope", () => {
  it("maps an Error + metadata into the envelope shape", () => {
    const env = buildAsyncFailureEnvelope({
      functionId: "stripe-reconciliation-hourly",
      eventName: "0 * * * *",
      attempts: 3,
      retryable: true,
      error: new Error("boom"),
      occurredAt: "2026-05-25T07:00:00.000Z",
    });
    expect(env.code).toBe("ASYNC_JOB_FAILED");
    expect(env.message).toBe("boom");
    expect(env.functionId).toBe("stripe-reconciliation-hourly");
    expect(env.attempts).toBe(3);
    expect(env.retryable).toBe(true);
  });

  it("uses a string error's value as the message", () => {
    const env = buildAsyncFailureEnvelope({
      functionId: "x",
      eventName: "e",
      attempts: 1,
      retryable: false,
      error: "raw failure",
      occurredAt: "2026-05-25T07:00:00.000Z",
    });
    expect(env.message).toBe("raw failure");
  });

  it("uses an error object's string `code` when present", () => {
    const err = Object.assign(new Error("nope"), { code: "UPSTREAM_TIMEOUT" });
    const env = buildAsyncFailureEnvelope({
      functionId: "x",
      eventName: "e",
      attempts: 1,
      retryable: true,
      error: err,
      occurredAt: "2026-05-25T07:00:00.000Z",
    });
    expect(env.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("threads optional org/deployment/stage/runId", () => {
    const env = buildAsyncFailureEnvelope({
      functionId: "x",
      eventName: "e",
      attempts: 1,
      retryable: false,
      error: new Error("e"),
      occurredAt: "2026-05-25T07:00:00.000Z",
      organizationId: "org_1",
      deploymentId: "dep_1",
      stage: "fetch",
      runId: "r1",
    });
    expect(env).toMatchObject({
      organizationId: "org_1",
      deploymentId: "dep_1",
      stage: "fetch",
      runId: "r1",
    });
  });

  it("omits optional fields entirely when not provided (no undefined keys)", () => {
    const env = buildAsyncFailureEnvelope({
      functionId: "x",
      eventName: "e",
      attempts: 1,
      retryable: false,
      error: new Error("e"),
      occurredAt: "2026-05-25T07:00:00.000Z",
    });
    expect("organizationId" in env).toBe(false);
    expect("stage" in env).toBe(false);
  });
});

function makeCtx() {
  const recorded: unknown[] = [];
  const sent: unknown[] = [];
  const alerted: unknown[] = [];
  const ctx = {
    auditLedger: {
      record: async (p: unknown) => {
        recorded.push(p);
        return {} as never;
      },
    } as unknown as AuditLedger,
    operatorAlerter: {
      alert: async (p: unknown) => {
        alerted.push(p);
      },
    } as OperatorAlerter,
    inngest: {
      send: async (e: unknown) => {
        sent.push(e);
      },
    },
  };
  return { ctx, recorded, sent, alerted };
}

// onFailure arg shape per verified Inngest v4.2.4 (FailureEventArgs):
const failureArg = {
  error: new Error("boom"),
  event: {
    name: "inngest/function.failed",
    data: {
      function_id: "stripe-reconciliation-hourly",
      run_id: "run_1",
      error: {},
      event: { name: "0 * * * *" },
    },
  },
};

describe("makeOnFailureHandler", () => {
  it("Class A: records audit + sends domain event + alerts", async () => {
    const { ctx, recorded, sent, alerted } = makeCtx();
    const onFailure = makeOnFailureHandler(
      {
        functionId: "stripe-reconciliation-hourly",
        eventDomain: "stripe-reconciliation",
        riskCategory: "high",
        alert: true,
      },
      ctx,
    );
    await onFailure(failureArg as never);
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { eventType: string }).eventType).toBe(
      "infrastructure.job.retry_exhausted",
    );
    expect((recorded[0] as { actorId: string }).actorId).toBe("stripe-reconciliation-hourly");
    expect((sent[0] as { name: string }).name).toBe("stripe-reconciliation.failed");
    expect(alerted).toHaveLength(1);
    expect((alerted[0] as { source: string }).source).toBe("inngest_function");
  });

  it("Class E: records audit only (no event, no alert) when emitEvent is false", async () => {
    const { ctx, recorded, sent, alerted } = makeCtx();
    const onFailure = makeOnFailureHandler(
      {
        functionId: "memory-daily-pattern-decay",
        riskCategory: "low",
        alert: false,
        emitEvent: false,
      },
      ctx,
    );
    await onFailure(failureArg as never);
    expect(recorded).toHaveLength(1);
    expect(sent).toHaveLength(0);
    expect(alerted).toHaveLength(0);
  });

  it("derives run_id and entityId from the failure event", async () => {
    const { ctx, recorded } = makeCtx();
    const onFailure = makeOnFailureHandler(
      { functionId: "x", eventDomain: "x", riskCategory: "low", alert: false },
      ctx,
    );
    await onFailure(failureArg as never);
    expect((recorded[0] as { entityId: string }).entityId).toBe("run_1");
  });

  it("includes the original trigger payload on the emitted .failed event", async () => {
    const { ctx, sent } = makeCtx();
    const onFailure = makeOnFailureHandler(
      {
        functionId: "creative-job-runner",
        eventDomain: "creative.polished",
        riskCategory: "medium",
        alert: false,
      },
      ctx,
    );
    await onFailure({
      error: new Error("boom"),
      event: {
        name: "inngest/function.failed",
        data: {
          run_id: "run_1",
          event: {
            name: "creative-pipeline/polished.submitted",
            data: { jobId: "job_1", organizationId: "org_1" },
          },
        },
      },
    } as never);
    expect(sent).toHaveLength(1);
    expect((sent[0] as { name: string }).name).toBe("creative.polished.failed");
    expect((sent[0] as { data: Record<string, unknown> }).data.trigger).toEqual({
      jobId: "job_1",
      organizationId: "org_1",
    });
    // envelope fields still ride alongside the trigger
    expect((sent[0] as { data: Record<string, unknown> }).data.code).toBe("ASYNC_JOB_FAILED");
  });

  it("emits with no trigger key when the original payload is absent", async () => {
    const { ctx, sent } = makeCtx();
    const onFailure = makeOnFailureHandler(
      { functionId: "x", eventDomain: "x", riskCategory: "low", alert: false },
      ctx,
    );
    await onFailure(failureArg as never); // failureArg's inner event carries no data
    expect((sent[0] as { data: Record<string, unknown> }).data).not.toHaveProperty("trigger");
  });

  it("never throws out of onFailure even if audit recording fails", async () => {
    const ctx = {
      auditLedger: {
        record: async () => {
          throw new Error("audit down");
        },
      } as unknown as AuditLedger,
      operatorAlerter: { alert: async () => {} } as OperatorAlerter,
      inngest: { send: async () => {} },
    };
    const onFailure = makeOnFailureHandler(
      { functionId: "x", eventDomain: "x", riskCategory: "low", alert: false },
      ctx,
    );
    await expect(onFailure(failureArg as never)).resolves.toBeUndefined();
  });
});
