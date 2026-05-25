import { describe, it, expect } from "vitest";
import { buildAsyncFailureEnvelope } from "../async-failure-handler.js";

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
