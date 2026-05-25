import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import type { PlatformIngressConfig, GovernanceGateInterface } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { ExecutionMode } from "../execution-context.js";
import type { GovernanceDecision } from "../governance-types.js";
import type { WorkTraceStore } from "../work-trace-recorder.js";
import type { AuditLedger } from "../../audit/ledger.js";
import type { OperatorAlerter } from "../../observability/operator-alerter.js";

const testConstraints = {
  allowedModelTiers: ["default"] as ["default"],
  maxToolCalls: 5,
  maxLlmTurns: 3,
  maxTotalTokens: 4000,
  maxRuntimeMs: 30000,
  maxWritesPerExecution: 2,
  trustLevel: "guided" as const,
};

const testRegistration = {
  intent: "operator.test_mutation",
  defaultMode: "operator_mutation" as const,
  allowedModes: ["operator_mutation"] as ["operator_mutation"],
  executor: { mode: "operator_mutation" as const },
  parameterSchema: {},
  mutationClass: "write" as const,
  budgetClass: "cheap" as const,
  approvalPolicy: "none" as const,
  approvalMode: "system_auto_approved" as const,
  idempotent: true,
  allowedTriggers: ["api" as const],
  timeoutMs: 30000,
  retryable: false,
};

function buildExecuteDecision(): GovernanceDecision {
  return {
    outcome: "execute",
    riskScore: 0.2,
    budgetProfile: "standard",
    constraints: testConstraints,
    matchedPolicies: ["default-policy"],
  };
}

function makeThrowingMode(err: Error): ExecutionMode {
  return { name: "operator_mutation", execute: vi.fn().mockRejectedValue(err) };
}

function makeTraceStore(): WorkTraceStore {
  return {
    persist: vi.fn().mockResolvedValue(undefined),
    getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    getByWorkUnitId: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as WorkTraceStore;
}

function buildConfig(overrides: {
  mode: ExecutionMode;
  traceStore?: WorkTraceStore;
  alerter?: OperatorAlerter;
  auditLedger?: AuditLedger;
  delayFn?: (ms: number) => Promise<void>;
}): PlatformIngressConfig {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(testRegistration as never);
  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(overrides.mode);
  const governanceGate: GovernanceGateInterface = {
    evaluate: vi.fn().mockResolvedValue(buildExecuteDecision()),
  };
  return {
    intentRegistry,
    modeRegistry,
    governanceGate,
    deploymentResolver: {
      resolve: vi.fn().mockResolvedValue({
        deploymentId: "dep-1",
        skillSlug: "test",
        trustScore: 42,
      }),
    } as never,
    traceStore: overrides.traceStore,
    operatorAlerter: overrides.alerter,
    auditLedger: overrides.auditLedger,
    delayFn: overrides.delayFn,
  };
}

const baseRequest = {
  intent: "operator.test_mutation",
  trigger: "api" as const,
  organizationId: "org_1",
  actor: { id: "actor_1", type: "user" as const },
  parameters: {},
  surface: { surface: "api" as const, requestId: "req_test" },
};

describe("PlatformIngress execution-path exception", () => {
  it("persists a failed WorkTrace with EXECUTION_EXCEPTION and rethrows the original error", async () => {
    const boom = new Error("db blip");
    const traceStore = makeTraceStore();
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) } as unknown as OperatorAlerter;
    const auditLedger = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLedger;
    const ingress = new PlatformIngress(
      buildConfig({ mode: makeThrowingMode(boom), traceStore, alerter, auditLedger }),
    );

    await expect(ingress.submit(baseRequest)).rejects.toBe(boom);

    expect(traceStore.persist).toHaveBeenCalledTimes(1);
    const persisted = (traceStore.persist as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(persisted.outcome).toBe("failed");
    expect(persisted.error?.code).toBe("EXECUTION_EXCEPTION");

    expect(
      (auditLedger.record as ReturnType<typeof vi.fn>).mock.calls[0]![0].snapshot,
    ).toMatchObject({
      errorType: "execution_exception",
      failureClass: "infrastructure",
      severity: "critical",
    });
  });

  it("same-key replay returns the stored failure and does not re-dispatch", async () => {
    const boom = new Error("db blip");
    const mode = makeThrowingMode(boom);
    const failedTrace = {
      workUnitId: "wu_1",
      outcome: "failed" as const,
      mode: "operator_mutation",
      traceId: "t_1",
      organizationId: "org_1",
      actor: baseRequest.actor,
      intent: baseRequest.intent,
      parameters: {},
      requestedAt: new Date().toISOString(),
      idempotencyKey: "key-1",
      executionSummary: "Execution failed",
      executionOutputs: {},
      error: { code: "EXECUTION_EXCEPTION", message: "Execution failed" },
      deploymentContext: { deploymentId: "dep-1" },
    };
    const traceStore = makeTraceStore();
    (traceStore.getByIdempotencyKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      trace: failedTrace,
    });
    const ingress = new PlatformIngress(buildConfig({ mode, traceStore }));

    const res = await ingress.submit({ ...baseRequest, idempotencyKey: "key-1" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.outcome).toBe("failed");
    expect(mode.execute).not.toHaveBeenCalled();
  });

  it("a handler that RETURNS outcome:failed is not classified as EXECUTION_EXCEPTION", async () => {
    const domainFailMode: ExecutionMode = {
      name: "operator_mutation",
      execute: vi.fn().mockResolvedValue({
        workUnitId: "wu_1",
        outcome: "failed",
        summary: "not found",
        outputs: {},
        mode: "operator_mutation",
        durationMs: 1,
        traceId: "t_1",
        error: { code: "OPPORTUNITY_NOT_FOUND", message: "not found" },
      }),
    };
    const traceStore = makeTraceStore();
    const ingress = new PlatformIngress(buildConfig({ mode: domainFailMode, traceStore }));

    const res = await ingress.submit(baseRequest);

    expect(res.ok).toBe(true);
    const persisted = (traceStore.persist as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(persisted.outcome).toBe("failed");
    expect(persisted.error?.code).toBe("OPPORTUNITY_NOT_FOUND");
    expect(persisted.error?.code).not.toBe("EXECUTION_EXCEPTION");
  });

  it("trace-persist failure does not mask the original execution exception", async () => {
    const boom = new Error("handler boom");
    const traceStore = makeTraceStore();
    // Force every persist attempt to throw — persistTrace must swallow these.
    (traceStore.persist as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("trace store down"),
    );
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) } as unknown as OperatorAlerter;
    const auditLedger = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLedger;
    // delayFn no-op so the persist retry loop does not actually sleep
    const ingress = new PlatformIngress(
      buildConfig({
        mode: makeThrowingMode(boom),
        traceStore,
        alerter,
        auditLedger,
        delayFn: async () => {},
      }),
    );

    // The rejection must be the ORIGINAL handler error, not "trace store down".
    await expect(ingress.submit(baseRequest)).rejects.toBe(boom);
  });
});
