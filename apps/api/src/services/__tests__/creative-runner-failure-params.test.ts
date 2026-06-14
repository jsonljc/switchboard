import { afterEach, describe, expect, it, vi } from "vitest";
import { makeOnFailureHandler } from "@switchboard/core";
import type { AsyncFailureContext } from "@switchboard/core";
import { selectOperatorAlerter } from "../../bootstrap/select-operator-alerter.js";
import {
  CREATIVE_POLISHED_RUNNER_FAILURE_PARAMS,
  CREATIVE_UGC_RUNNER_FAILURE_PARAMS,
} from "../creative-runner-failure-params.js";

// onFailure arg shape per verified Inngest v4.2.4 (FailureEventArgs).
const failureArg = {
  error: new Error("render exhausted"),
  event: {
    data: {
      run_id: "run-1",
      event: { name: "creative.job.requested", data: { jobId: "j1", organizationId: "org-1" } },
    },
  },
};

function stubCtx(): Pick<AsyncFailureContext, "auditLedger" | "inngest"> {
  return {
    auditLedger: {
      record: async () => ({}) as never,
    } as unknown as AsyncFailureContext["auditLedger"],
    inngest: { send: async () => ({}) },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("creative runner failure params (D9-F1 classification)", () => {
  it("polished render is page-worthy: alert true, severity warning, medium, creative.polished", () => {
    expect(CREATIVE_POLISHED_RUNNER_FAILURE_PARAMS).toMatchObject({
      functionId: "creative-job-runner",
      eventDomain: "creative.polished",
      riskCategory: "medium",
      alert: true,
      severity: "warning",
    });
  });

  it("ugc render is page-worthy: alert true, severity warning, medium, creative.ugc", () => {
    expect(CREATIVE_UGC_RUNNER_FAILURE_PARAMS).toMatchObject({
      functionId: "ugc-job-runner",
      eventDomain: "creative.ugc",
      riskCategory: "medium",
      alert: true,
      severity: "warning",
    });
  });

  it("(a)+(b) end to end: webhook selected, polished dead-letter POSTs a warning page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const operatorAlerter = selectOperatorAlerter({
      OPERATOR_ALERT_WEBHOOK_URL: "https://hooks.example/x",
    });
    const handler = makeOnFailureHandler(CREATIVE_POLISHED_RUNNER_FAILURE_PARAMS, {
      ...stubCtx(),
      operatorAlerter,
    });

    await handler(failureArg as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      errorType: "async_job_retry_exhausted",
      severity: "warning",
      source: "inngest_function",
    });
    expect(body.errorMessage).toContain("creative-job-runner");
  });

  it("(c) an audit-only (alert:false) failure does NOT page even with a webhook configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const operatorAlerter = selectOperatorAlerter({
      OPERATOR_ALERT_WEBHOOK_URL: "https://hooks.example/x",
    });
    const handler = makeOnFailureHandler(
      {
        functionId: "memory-daily-pattern-decay",
        riskCategory: "low",
        alert: false,
        emitEvent: false,
      },
      { ...stubCtx(), operatorAlerter },
    );

    await handler(failureArg as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
