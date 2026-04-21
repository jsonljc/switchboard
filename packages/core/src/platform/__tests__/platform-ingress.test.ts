import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { GovernanceGateInterface, PlatformIngressConfig } from "../platform-ingress.js";
import type { WorkTraceStore } from "../work-trace-recorder.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { ExecutionResult } from "../execution-result.js";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";
import type { ExecutionMode } from "../execution-context.js";
import type { CanonicalSubmitRequest } from "../canonical-request.js";

const testConstraints: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 5,
  maxLlmTurns: 3,
  maxTotalTokens: 4000,
  maxRuntimeMs: 30000,
  maxWritesPerExecution: 2,
  trustLevel: "guided",
};

const testRegistration: IntentRegistration = {
  intent: "campaign.pause",
  defaultMode: "skill",
  allowedModes: ["skill"],
  executor: { mode: "skill", skillSlug: "pause-campaign" },
  parameterSchema: {},
  mutationClass: "write",
  budgetClass: "standard",
  approvalPolicy: "none",
  idempotent: false,
  allowedTriggers: ["chat", "api"],
  timeoutMs: 30000,
  retryable: false,
};

const baseRequest: CanonicalSubmitRequest = {
  organizationId: "org-1",
  actor: { id: "user-1", type: "user" },
  intent: "campaign.pause",
  parameters: { campaignId: "camp-123" },
  trigger: "chat",
  surface: {
    surface: "chat",
    requestId: "req-base",
  },
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

function buildDenyDecision(): GovernanceDecision {
  return {
    outcome: "deny",
    reasonCode: "BUDGET_EXCEEDED",
    riskScore: 0.9,
    matchedPolicies: ["budget-limit"],
  };
}

function buildApprovalDecision(): GovernanceDecision {
  return {
    outcome: "require_approval",
    riskScore: 0.6,
    approvalLevel: "manager",
    approvers: ["mgr-1"],
    constraints: testConstraints,
    matchedPolicies: ["approval-required"],
  };
}

function createMockMode(): ExecutionMode {
  return {
    name: "skill",
    execute: vi.fn().mockResolvedValue({
      workUnitId: "mock",
      outcome: "completed",
      summary: "Done",
      outputs: { result: true },
      mode: "skill",
      durationMs: 100,
      traceId: "mock-trace",
    } satisfies ExecutionResult),
  };
}

function createConfig(
  overrides: {
    decision?: GovernanceDecision;
    governanceThrows?: boolean;
    traceStore?: WorkTraceStore;
    mode?: ExecutionMode;
    resolveDeployment?: ReturnType<typeof vi.fn>;
  } = {},
): PlatformIngressConfig {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(testRegistration);

  const modeRegistry = new ExecutionModeRegistry();
  const mode = overrides.mode ?? createMockMode();
  modeRegistry.register(mode);

  const governanceGate: GovernanceGateInterface = {
    evaluate: overrides.governanceThrows
      ? vi.fn().mockRejectedValue(new Error("boom"))
      : vi.fn().mockResolvedValue(overrides.decision ?? buildExecuteDecision()),
  };

  return {
    intentRegistry,
    modeRegistry,
    governanceGate,
    deploymentResolver: {
      resolve:
        overrides.resolveDeployment ??
        vi.fn().mockResolvedValue({
          deploymentId: "dep-1",
          skillSlug: "test-skill",
          trustLevel: "guided",
          trustScore: 42,
        }),
    },
    traceStore: overrides.traceStore,
  };
}

describe("PlatformIngress", () => {
  it("returns IngressError for unknown intent", async () => {
    const config = createConfig();
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit({ ...baseRequest, intent: "unknown.action" });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.type).toBe("intent_not_found");
      expect(response.error.intent).toBe("unknown.action");
    }
  });

  it("returns IngressError for disallowed trigger", async () => {
    const config = createConfig();
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit({ ...baseRequest, trigger: "schedule" });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.type).toBe("trigger_not_allowed");
      expect(response.error.intent).toBe("campaign.pause");
    }
  });

  it("returns deny result when governance denies", async () => {
    const config = createConfig({ decision: buildDenyDecision() });
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("failed");
      expect(response.result.error?.code).toBe("BUDGET_EXCEEDED");
    }
  });

  it("returns pending_approval when governance requires approval", async () => {
    const config = createConfig({ decision: buildApprovalDecision() });
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("pending_approval");
      expect("approvalRequired" in response && response.approvalRequired).toBe(true);
    }
  });

  it("dispatches to correct mode and returns completed result", async () => {
    const mode = createMockMode();
    const config = createConfig({ mode });
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("completed");
      expect(response.result.outputs).toEqual({ result: true });
      expect(mode.execute).toHaveBeenCalledOnce();
    }
  });

  it("persists WorkTrace on successful execution", async () => {
    const traceStore: WorkTraceStore = {
      persist: vi.fn().mockResolvedValue(undefined),
      getByWorkUnitId: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };
    const config = createConfig({ traceStore });
    const ingress = new PlatformIngress(config);

    await ingress.submit(baseRequest);

    expect(traceStore.persist).toHaveBeenCalledOnce();
    const trace = vi.mocked(traceStore.persist).mock.calls[0]![0];
    expect(trace.outcome).toBe("completed");
    expect(trace.governanceOutcome).toBe("execute");
    expect(trace.intent).toBe("campaign.pause");
  });

  it("persists WorkTrace on governance deny", async () => {
    const traceStore: WorkTraceStore = {
      persist: vi.fn().mockResolvedValue(undefined),
      getByWorkUnitId: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };
    const config = createConfig({ decision: buildDenyDecision(), traceStore });
    const ingress = new PlatformIngress(config);

    await ingress.submit(baseRequest);

    expect(traceStore.persist).toHaveBeenCalledOnce();
    const trace = vi.mocked(traceStore.persist).mock.calls[0]![0];
    expect(trace.outcome).toBe("failed");
    expect(trace.governanceOutcome).toBe("deny");
  });

  it("normalizes WorkUnit with generated id and traceId", async () => {
    const config = createConfig();
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.workUnit.id).toBeDefined();
      expect(response.workUnit.id.length).toBeGreaterThan(0);
      expect(response.workUnit.traceId).toBeDefined();
      expect(response.workUnit.traceId.length).toBeGreaterThan(0);
      expect(response.workUnit.resolvedMode).toBe("skill");
      expect(response.workUnit.organizationId).toBe("org-1");
    }
  });

  it("resolves deployment inside PlatformIngress from canonical request fields", async () => {
    const resolveDeployment = vi.fn().mockResolvedValue({
      deploymentId: "dep-resolved",
      skillSlug: "pause-campaign",
      trustLevel: "guided",
      trustScore: 42,
    });
    const config = createConfig({
      resolveDeployment,
    });
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit({
      organizationId: "org-1",
      actor: { id: "user-1", type: "user" },
      intent: "campaign.pause",
      parameters: { campaignId: "camp-123" },
      trigger: "api",
      surface: {
        surface: "api",
        requestId: "req-1",
      },
      targetHint: {
        skillSlug: "pause-campaign",
      },
    });

    expect(resolveDeployment).toHaveBeenCalledOnce();
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.workUnit.deployment.deploymentId).toBe("dep-resolved");
      expect(response.workUnit.traceId.length).toBeGreaterThan(0);
    }
  });
});
