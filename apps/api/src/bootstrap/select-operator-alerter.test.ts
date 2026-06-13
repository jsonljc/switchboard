import { afterEach, describe, expect, it, vi } from "vitest";
import { NoopOperatorAlerter, WebhookOperatorAlerter } from "@switchboard/core";
import type { InfrastructureFailureAlert } from "@switchboard/core";
import { selectOperatorAlerter } from "./select-operator-alerter.js";

const samplePayload: InfrastructureFailureAlert = {
  errorType: "async_job_retry_exhausted",
  severity: "warning",
  errorMessage: "boom",
  retryable: false,
  occurredAt: "2026-06-13T00:00:00.000Z",
  source: "inngest_function",
};

afterEach(() => vi.unstubAllGlobals());

describe("selectOperatorAlerter", () => {
  it("returns a WebhookOperatorAlerter when the webhook URL is set", () => {
    const alerter = selectOperatorAlerter({
      OPERATOR_ALERT_WEBHOOK_URL: "https://hooks.example/x",
    });
    expect(alerter).toBeInstanceOf(WebhookOperatorAlerter);
  });

  it("returns a NoopOperatorAlerter when the webhook URL is unset", () => {
    expect(selectOperatorAlerter({})).toBeInstanceOf(NoopOperatorAlerter);
  });

  it("treats an empty / whitespace-only URL as unset (Noop, paging off)", () => {
    expect(selectOperatorAlerter({ OPERATOR_ALERT_WEBHOOK_URL: "" })).toBeInstanceOf(
      NoopOperatorAlerter,
    );
    expect(selectOperatorAlerter({ OPERATOR_ALERT_WEBHOOK_URL: "   " })).toBeInstanceOf(
      NoopOperatorAlerter,
    );
  });

  it("sends the secret as a Bearer Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const alerter = selectOperatorAlerter({
      OPERATOR_ALERT_WEBHOOK_URL: "https://hooks.example/x",
      OPERATOR_ALERT_WEBHOOK_SECRET: "s3cret",
    });
    await alerter.alert(samplePayload);
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer s3cret");
  });

  it("omits the Authorization header when no secret is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const alerter = selectOperatorAlerter({
      OPERATOR_ALERT_WEBHOOK_URL: "https://hooks.example/x",
    });
    await alerter.alert(samplePayload);
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
