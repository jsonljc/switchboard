import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import type { GovernanceGateInterface } from "../platform-ingress.js";
import type { OperatorAlerter } from "../../observability/operator-alerter.js";
import type { AuditLedger } from "../../audit/ledger.js";

function makeIntentRegistry() {
  return {
    lookup: vi.fn().mockReturnValue({
      intent: "test.intent",
      triggers: ["api"],
      mode: "skill",
      slug: "test",
      defaultMode: "skill",
      allowedModes: ["skill"],
      executor: { mode: "skill", skillSlug: "test" },
      parameterSchema: {},
      mutationClass: "read",
      budgetClass: "standard",
      approvalPolicy: "none",
      idempotent: false,
      allowedTriggers: ["api"],
      timeoutMs: 30000,
      retryable: false,
    }),
    validateTrigger: vi.fn().mockReturnValue(true),
    resolveMode: vi.fn().mockReturnValue("skill"),
  };
}
function makeModeRegistry() {
  return { dispatch: vi.fn() };
}
function makeDeploymentResolver() {
  return {
    resolve: vi.fn().mockResolvedValue({
      deploymentId: "dep_1",
      skillSlug: "test",
      trustScore: 50,
    }),
  };
}
function makeThrowingGate(): GovernanceGateInterface {
  return { evaluate: vi.fn().mockRejectedValue(new Error("gate exploded")) };
}
function makeTraceStore() {
  return {
    persist: vi.fn().mockResolvedValue(undefined),
    getByIdempotencyKey: vi.fn().mockResolvedValue(null),
  };
}

const baseRequest = {
  intent: "test.intent",
  trigger: "api" as const,
  organizationId: "org_1",
  actor: { id: "actor_1", type: "user" as const },
  parameters: {},
  surface: { surface: "api" as const, requestId: "req_test" },
};

describe("PlatformIngress governance error path", () => {
  let alerter: OperatorAlerter & { alert: ReturnType<typeof vi.fn> };
  let auditLedger: { record: ReturnType<typeof vi.fn> };
  let gate: GovernanceGateInterface;

  beforeEach(() => {
    alerter = { alert: vi.fn().mockResolvedValue(undefined) };
    auditLedger = { record: vi.fn().mockResolvedValue(undefined) };
    gate = makeThrowingGate();
  });

  function buildIngress(opts?: { withAudit?: boolean }) {
    return new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: gate,
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: makeTraceStore() as never,
      operatorAlerter: alerter,
      auditLedger: opts?.withAudit === false ? undefined : (auditLedger as unknown as AuditLedger),
    });
  }

  it("returns ok:true with denied result and reasonCode GOVERNANCE_ERROR", async () => {
    const result = await buildIngress().submit(baseRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.outcome).toBe("failed");
    expect(result.result.error?.code).toBe("GOVERNANCE_ERROR");
  });

  it("writes one infra-failure audit entry with errorType=governance_eval_exception", async () => {
    await buildIngress().submit(baseRequest);
    expect(auditLedger.record).toHaveBeenCalledTimes(1);
    const params = auditLedger.record.mock.calls[0]![0];
    expect(params.eventType).toBe("action.failed");
    expect(params.snapshot).toMatchObject({
      errorType: "governance_eval_exception",
      failureClass: "infrastructure",
      severity: "critical",
      retryable: false,
    });
  });

  it("fires operator alerter exactly once with matching payload", async () => {
    await buildIngress().submit(baseRequest);
    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(alerter.alert.mock.calls[0]![0]).toMatchObject({
      errorType: "governance_eval_exception",
      severity: "critical",
      source: "platform_ingress",
      retryable: false,
    });
  });

  it("does not retry governance evaluation", async () => {
    await buildIngress().submit(baseRequest);
    expect(gate.evaluate).toHaveBeenCalledTimes(1);
  });

  it("still alerts when auditLedger is absent and does not throw", async () => {
    const ingress = buildIngress({ withAudit: false });
    const result = await ingress.submit(baseRequest);
    expect(result.ok).toBe(true);
    expect(alerter.alert).toHaveBeenCalledTimes(1);
  });

  it("swallows audit-write failure and still alerts; no second infra-failure entry", async () => {
    auditLedger.record.mockRejectedValueOnce(new Error("ledger down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await buildIngress().submit(baseRequest);
    expect(result.ok).toBe(true);
    expect(auditLedger.record).toHaveBeenCalledTimes(1); // not retried, not re-emitted
    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
