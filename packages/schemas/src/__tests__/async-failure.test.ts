import { describe, it, expect } from "vitest";
import { AsyncFailureEnvelopeSchema } from "../async-failure.js";

describe("AsyncFailureEnvelopeSchema", () => {
  const valid = {
    code: "UPSTREAM_TIMEOUT",
    message: "Stripe API timed out",
    functionId: "stripe-reconciliation-hourly",
    eventName: "0 * * * *",
    attempts: 3,
    retryable: true,
    occurredAt: "2026-05-25T07:00:00.000Z",
  };

  it("accepts a minimal valid envelope", () => {
    expect(() => AsyncFailureEnvelopeSchema.parse(valid)).not.toThrow();
  });

  it("requires the shared ExecutionError core (code + message)", () => {
    const { code: _c, ...noCode } = valid;
    expect(() => AsyncFailureEnvelopeSchema.parse(noCode)).toThrow();
  });

  it("accepts optional org/deployment/runId/stage", () => {
    const full = {
      ...valid,
      stage: "fetch",
      runId: "01H...",
      organizationId: "org_1",
      deploymentId: "dep_1",
    };
    expect(() => AsyncFailureEnvelopeSchema.parse(full)).not.toThrow();
  });

  it("rejects a non-ISO occurredAt", () => {
    expect(() =>
      AsyncFailureEnvelopeSchema.parse({ ...valid, occurredAt: "not-a-date" }),
    ).toThrow();
  });
});
