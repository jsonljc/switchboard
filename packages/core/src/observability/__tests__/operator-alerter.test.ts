import { describe, it, expect } from "vitest";
import { NoopOperatorAlerter } from "../operator-alerter.js";
import type { InfrastructureFailureAlert } from "../operator-alerter.js";

const samplePayload: InfrastructureFailureAlert = {
  errorType: "governance_eval_exception",
  severity: "critical",
  errorMessage: "boom",
  retryable: false,
  occurredAt: "2026-04-28T00:00:00.000Z",
  source: "platform_ingress",
};

describe("NoopOperatorAlerter", () => {
  it("resolves without throwing and performs no I/O", async () => {
    const alerter = new NoopOperatorAlerter();
    await expect(alerter.alert(samplePayload)).resolves.toBeUndefined();
  });
});
