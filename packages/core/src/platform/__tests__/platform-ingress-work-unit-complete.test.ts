import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import { ApprovalLifecycleService } from "../../approval/lifecycle-service.js";
import { InMemoryLifecycleStore } from "../../approval/in-memory-lifecycle-store.js";
import type { WorkTraceStore } from "../work-trace-recorder.js";
import type { GovernanceDecision } from "../governance-types.js";
import type { GovernanceGateInterface } from "../platform-ingress.js";
import type { CanonicalSubmitRequest } from "../canonical-request.js";

const CONSTRAINTS = {
  maxToolCalls: 5,
  maxLlmTurns: 3,
  maxTotalTokens: 4000,
  maxRuntimeMs: 30000,
  maxWritesPerExecution: 2,
  trustLevel: "guided",
} as const;

function requireApprovalDecision(): GovernanceDecision {
  return {
    outcome: "require_approval",
    riskScore: 0.5,
    approvalLevel: "operator",
    approvers: [],
    constraints: { ...CONSTRAINTS, allowedModelTiers: ["default"] },
    matchedPolicies: ["policy.requires-approval"],
  };
}

function executeDecision(): GovernanceDecision {
  return {
    outcome: "execute",
    riskScore: 0,
    budgetProfile: "standard",
    constraints: { ...CONSTRAINTS, allowedModelTiers: ["default"] },
    matchedPolicies: [],
  };
}

function denyDecision(): GovernanceDecision {
  return { outcome: "deny", reasonCode: "BLOCKED", riskScore: 1, matchedPolicies: [] };
}

function makeRequest(): CanonicalSubmitRequest {
  return {
    organizationId: "org_test",
    actor: { id: "system", type: "system" },
    intent: "noop.intent",
    parameters: { a: 1 },
    trigger: "api",
    surface: { surface: "api" },
  };
}

function buildIngress(opts: {
  decision?: GovernanceDecision;
  governanceGate?: GovernanceGateInterface;
  onWorkUnitComplete?: (info: { organizationId: string; workUnitId: string }) => void;
  withLifecycle?: boolean;
  traceStore?: WorkTraceStore;
}): PlatformIngress {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register({
    intent: "noop.intent",
    allowedTriggers: ["api"],
    defaultMode: "skill",
    allowedModes: ["skill"],
    executor: { mode: "skill", skillSlug: "noop" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "standard",
    approvalPolicy: "none",
    idempotent: false,
    timeoutMs: 30000,
    retryable: false,
  });

  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register({
    name: "skill",
    execute: vi.fn().mockResolvedValue({
      workUnitId: "wu_1",
      outcome: "completed" as const,
      summary: "ok",
      outputs: {},
      mode: "skill",
      durationMs: 1,
      traceId: "tr_1",
    }),
  });

  return new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: opts.governanceGate ?? {
      evaluate: async () => opts.decision ?? executeDecision(),
    },
    deploymentResolver: {
      resolve: async () =>
        ({
          deploymentId: "dep_1",
          organizationId: "org_test",
          agentRosterId: "agent_1",
          skillSlug: "noop",
          agentRole: "responder",
          status: "active",
        }) as never,
    },
    lifecycleService:
      opts.withLifecycle === false
        ? undefined
        : new ApprovalLifecycleService({ store: new InMemoryLifecycleStore() }),
    traceStore: opts.traceStore,
    onWorkUnitComplete: opts.onWorkUnitComplete,
  });
}

describe("PlatformIngress onWorkUnitComplete best-effort work-unit-complete hook", () => {
  it("fires exactly once on an EXECUTE/success decision with the work-unit identity", async () => {
    const onWorkUnitComplete = vi.fn();
    const ingress = buildIngress({ decision: executeDecision(), onWorkUnitComplete });

    const res = await ingress.submit(makeRequest());

    if (!res.ok) throw new Error("expected an ok:true response");
    expect(onWorkUnitComplete).toHaveBeenCalledTimes(1);
    expect(onWorkUnitComplete).toHaveBeenCalledWith({
      organizationId: "org_test",
      workUnitId: res.workUnit.id,
    });
  });

  it("fires exactly once on a DENY decision", async () => {
    const onWorkUnitComplete = vi.fn();
    const ingress = buildIngress({ decision: denyDecision(), onWorkUnitComplete });

    const res = await ingress.submit(makeRequest());

    if (!res.ok) throw new Error("expected an ok:true response");
    expect(onWorkUnitComplete).toHaveBeenCalledTimes(1);
    expect(onWorkUnitComplete).toHaveBeenCalledWith({
      organizationId: "org_test",
      workUnitId: res.workUnit.id,
    });
  });

  it("fires exactly once on a require_approval decision WITH lifecycle", async () => {
    const onWorkUnitComplete = vi.fn();
    const ingress = buildIngress({ decision: requireApprovalDecision(), onWorkUnitComplete });

    const res = await ingress.submit(makeRequest());

    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(onWorkUnitComplete).toHaveBeenCalledTimes(1);
    expect(onWorkUnitComplete).toHaveBeenCalledWith({
      organizationId: "org_test",
      workUnitId: res.workUnit.id,
    });
  });

  it("fires exactly once on a require_approval decision WITHOUT lifecycle", async () => {
    const onWorkUnitComplete = vi.fn();
    const ingress = buildIngress({
      decision: requireApprovalDecision(),
      onWorkUnitComplete,
      withLifecycle: false,
    });

    const res = await ingress.submit(makeRequest());

    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(onWorkUnitComplete).toHaveBeenCalledTimes(1);
    expect(onWorkUnitComplete).toHaveBeenCalledWith({
      organizationId: "org_test",
      workUnitId: res.workUnit.id,
    });
  });

  it("fires exactly once when the governance gate THROWS (governance-error leg)", async () => {
    const onWorkUnitComplete = vi.fn();
    const ingress = buildIngress({
      governanceGate: {
        evaluate: async () => {
          throw new Error("gov boom");
        },
      },
      onWorkUnitComplete,
    });

    const res = await ingress.submit(makeRequest());

    if (!res.ok) throw new Error("expected an ok:true response");
    expect(onWorkUnitComplete).toHaveBeenCalledTimes(1);
    expect(onWorkUnitComplete).toHaveBeenCalledWith({
      organizationId: "org_test",
      workUnitId: res.workUnit.id,
    });
  });

  it("does NOT fire on an intent-not-found (ok:false) request", async () => {
    const onWorkUnitComplete = vi.fn();
    const ingress = buildIngress({ decision: executeDecision(), onWorkUnitComplete });

    const res = await ingress.submit({ ...makeRequest(), intent: "unregistered.intent" });

    expect(res.ok).toBe(false);
    expect(onWorkUnitComplete).not.toHaveBeenCalled();
  });

  it("does NOT fire on an idempotency REPLAY (cached trace short-circuit)", async () => {
    const onWorkUnitComplete = vi.fn();
    const existingTrace = {
      outcome: "completed",
      workUnitId: "wu_replay",
      requestedAt: new Date().toISOString(),
      organizationId: "org_test",
      actor: { id: "system", type: "system" },
      intent: "noop.intent",
      parameters: { a: 1 },
      deploymentContext: {
        deploymentId: "dep_1",
        organizationId: "org_test",
        agentRosterId: "agent_1",
        skillSlug: "noop",
        agentRole: "responder",
        status: "active",
      },
      mode: "skill",
      durationMs: 1,
      traceId: "tr_replay",
      trigger: "api",
      idempotencyKey: "idem-1",
      executionSummary: "prior",
      executionOutputs: {},
      ingressPath: "platform_ingress",
    };
    const traceStore = {
      getByIdempotencyKey: async () => ({ trace: existingTrace }),
    } as never;
    const ingress = buildIngress({
      decision: executeDecision(),
      onWorkUnitComplete,
      traceStore,
    });

    const res = await ingress.submit({ ...makeRequest(), idempotencyKey: "idem-1" });

    expect(res.ok).toBe(true);
    expect(onWorkUnitComplete).not.toHaveBeenCalled();
  });

  it("a synchronously-throwing hook is logged (console.warn) and never breaks the submit", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ingress = buildIngress({
      decision: executeDecision(),
      onWorkUnitComplete: () => {
        throw new Error("boom");
      },
    });

    const res = await ingress.submit(makeRequest());

    if (!res.ok) throw new Error("expected an ok:true response");
    expect(res.workUnit.id).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[PlatformIngress] onWorkUnitComplete hook threw",
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("submits successfully with no hook configured (no throw, no fire)", async () => {
    const ingress = buildIngress({ decision: executeDecision() });
    const res = await ingress.submit(makeRequest());
    expect(res.ok).toBe(true);
  });
});
