import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
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

function makeGovernanceGate(): GovernanceGateInterface {
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

describe("WorkTrace persistence retry", () => {
  it("retries once on trace persist failure", async () => {
    const persistFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient DB error"))
      .mockResolvedValueOnce(undefined);

    const traceStore = {
      persist: persistFn,
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };

    const ingress = new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGovernanceGate() as never,
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
    });

    const result = await ingress.submit(baseRequest);

    expect(result.ok).toBe(true);
    // persist was called twice: first failed, second succeeded
    expect(persistFn).toHaveBeenCalledTimes(2);
  });

  it("logs error if both attempts fail but does not throw", async () => {
    const persistFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first fail"))
      .mockRejectedValueOnce(new Error("second fail"));

    const traceStore = {
      persist: persistFn,
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ingress = new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGovernanceGate() as never,
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
    });

    const result = await ingress.submit(baseRequest);

    // Submit still succeeds even if trace persistence fails
    expect(result.ok).toBe(true);
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to persist WorkTrace after retry",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
