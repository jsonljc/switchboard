import { describe, it, expect, vi } from "vitest";
import { PlatformIngress, TRACE_PERSIST_RETRY_POLICY } from "../platform-ingress.js";
import type { GovernanceGateInterface } from "../platform-ingress.js";

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
  return {
    dispatch: vi.fn().mockResolvedValue({
      workUnitId: "wu_1",
      outcome: "completed",
      summary: "OK",
      outputs: {},
      mode: "skill",
      durationMs: 100,
      traceId: "t_1",
    }),
  };
}
function makeGate(): GovernanceGateInterface {
  return {
    evaluate: vi.fn().mockResolvedValue({
      outcome: "execute",
      reasonCode: "ALLOWED",
      riskScore: 0,
      matchedPolicies: [],
      constraints: {
        allowedModelTiers: ["default"],
        maxToolCalls: 5,
        maxLlmTurns: 3,
        maxTotalTokens: 4000,
        maxRuntimeMs: 30000,
        maxWritesPerExecution: 2,
        trustLevel: "guided",
      },
    }),
  };
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

const baseRequest = {
  intent: "test.intent",
  trigger: "api" as const,
  organizationId: "org_1",
  actor: { id: "actor_1", type: "user" as const },
  parameters: {},
  surface: { surface: "api" as const, requestId: "req_test" },
};

const zeroDelay = () => Promise.resolve();

describe("WorkTrace persist — exponential backoff", () => {
  it("exposes retry policy constants", () => {
    expect(TRACE_PERSIST_RETRY_POLICY).toEqual({
      maxAttempts: 3,
      baseDelayMs: 100,
      factor: 4,
      jitterRatio: 0.25,
    });
  });

  it("succeeds on attempt 2 without writing audit/alert", async () => {
    const persistFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockResolvedValueOnce(undefined);
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };
    const auditLedger = { record: vi.fn() };
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) };

    const result = await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      auditLedger: auditLedger as never,
      operatorAlerter: alerter,
      delayFn: zeroDelay,
    }).submit(baseRequest);

    expect(result.ok).toBe(true);
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(auditLedger.record).not.toHaveBeenCalled();
    expect(alerter.alert).not.toHaveBeenCalled();
  });

  it("succeeds on attempt 3 without writing audit/alert", async () => {
    const persistFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockRejectedValueOnce(new Error("transient 2"))
      .mockResolvedValueOnce(undefined);
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };
    const auditLedger = { record: vi.fn() };
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) };

    await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      auditLedger: auditLedger as never,
      operatorAlerter: alerter,
      delayFn: zeroDelay,
    }).submit(baseRequest);

    expect(persistFn).toHaveBeenCalledTimes(3);
    expect(auditLedger.record).not.toHaveBeenCalled();
    expect(alerter.alert).not.toHaveBeenCalled();
  });

  it("does not emit console.error when persist eventually succeeds", async () => {
    const persistFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(undefined);
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) },
      delayFn: zeroDelay,
    }).submit(baseRequest);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("populates errorName and a truncated errorStack on terminal audit snapshot", async () => {
    const persistFn = vi.fn().mockRejectedValue(new TypeError("permanent"));
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };
    const auditLedger = { record: vi.fn().mockResolvedValue(undefined) };

    await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      auditLedger: auditLedger as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) },
      delayFn: zeroDelay,
    }).submit(baseRequest);

    expect(auditLedger.record).toHaveBeenCalledTimes(1);
    const snap = auditLedger.record.mock.calls[0]![0].snapshot as Record<string, unknown>;
    expect(snap.errorName).toBe("TypeError");
    expect(typeof snap.errorStack).toBe("string");
    expect((snap.errorStack as string).length).toBeLessThanOrEqual(2000);
  });

  it("after 3 terminal failures: writes one audit entry, fires one alert, does not throw", async () => {
    const persistFn = vi.fn().mockRejectedValue(new Error("permanent"));
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };
    const auditLedger = { record: vi.fn().mockResolvedValue(undefined) };
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) };

    const result = await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      auditLedger: auditLedger as never,
      operatorAlerter: alerter,
      delayFn: zeroDelay,
    }).submit(baseRequest);

    expect(result.ok).toBe(true);
    expect(persistFn).toHaveBeenCalledTimes(3);
    expect(auditLedger.record).toHaveBeenCalledTimes(1);
    const params = auditLedger.record.mock.calls[0]![0];
    expect(params.snapshot).toMatchObject({
      errorType: "trace_persist_failed",
      failureClass: "infrastructure",
      severity: "critical",
      retryable: false,
    });
    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(alerter.alert.mock.calls[0]![0]).toMatchObject({
      errorType: "trace_persist_failed",
      source: "platform_ingress",
    });
  });

  it("preserves the same WorkTrace identity across all retry attempts", async () => {
    const persistFn = vi.fn().mockRejectedValue(new Error("permanent"));
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };

    await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) },
      delayFn: zeroDelay,
    }).submit(baseRequest);

    const traceA = persistFn.mock.calls[0]![0];
    const traceB = persistFn.mock.calls[1]![0];
    const traceC = persistFn.mock.calls[2]![0];
    expect(traceA).toBe(traceB);
    expect(traceB).toBe(traceC);
    expect(traceA.traceId).toBe(traceC.traceId);
    expect(traceA.workUnitId).toBe(traceC.workUnitId);
  });

  it("invokes delayFn with bounded backoff between attempts", async () => {
    const persistFn = vi.fn().mockRejectedValue(new Error("permanent"));
    const delays: number[] = [];
    const delayFn = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };

    await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) },
      delayFn,
    }).submit(baseRequest);

    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(75);
    expect(delays[0]).toBeLessThanOrEqual(125);
    expect(delays[1]).toBeGreaterThanOrEqual(300);
    expect(delays[1]).toBeLessThanOrEqual(500);
  });
});
