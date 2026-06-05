import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import { ApprovalLifecycleService } from "../../approval/lifecycle-service.js";
import { InMemoryLifecycleStore } from "../../approval/in-memory-lifecycle-store.js";
import type { ApprovalNotifier } from "../../notifications/notifier.js";
import type { GovernanceDecision } from "../governance-types.js";
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
  decision: GovernanceDecision;
  notifier?: ApprovalNotifier;
  withLifecycle?: boolean;
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
    governanceGate: { evaluate: async () => opts.decision },
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
    approvalNotifier: opts.notifier,
  });
}

describe("PlatformIngress park-time approval notification", () => {
  it("fires exactly one notification carrying the lifecycle id and current bindingHash", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ingress = buildIngress({ decision: requireApprovalDecision(), notifier: { notify } });

    const res = await ingress.submit(makeRequest());

    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(notify).toHaveBeenCalledTimes(1);
    const notification = notify.mock.calls[0]![0];
    expect(notification.approvalId).toBe(res.lifecycleId);
    expect(notification.bindingHash).toBe(res.bindingHash);
    expect(notification.envelopeId).toBe(res.workUnit.id);
    // Substring assertions: the summary shape is pilot copy, not a contract.
    expect(notification.summary).toContain("noop.intent");
    expect(notification.summary).toContain("system");
    expect(notification.riskCategory).toBe("medium");
    expect(notification.explanation).toContain("operator");
    expect(notification.expiresAt).toBeInstanceOf(Date);
    expect(notification.approvers).toEqual([]);
  });

  it("falls back to the decision's approvers when routing config has none", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const decision = requireApprovalDecision();
    if (decision.outcome !== "require_approval") throw new Error("unreachable");
    decision.approvers = ["principal-1"];
    const ingress = buildIngress({ decision, notifier: { notify } });

    await ingress.submit(makeRequest());

    expect(notify.mock.calls[0]![0].approvers).toEqual(["principal-1"]);
  });

  it("normalizes an unknown riskCategory on the decision to medium", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const decision = requireApprovalDecision() as GovernanceDecision & Record<string, unknown>;
    decision["riskCategory"] = "banana";
    const ingress = buildIngress({ decision, notifier: { notify } });

    await ingress.submit(makeRequest());

    expect(notify.mock.calls[0]![0].riskCategory).toBe("medium");
  });

  it("passes a known riskCategory through", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const decision = requireApprovalDecision() as GovernanceDecision & Record<string, unknown>;
    decision["riskCategory"] = "high";
    const ingress = buildIngress({ decision, notifier: { notify } });

    await ingress.submit(makeRequest());

    expect(notify.mock.calls[0]![0].riskCategory).toBe("high");
  });

  it("does not notify on an execute outcome", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ingress = buildIngress({ decision: executeDecision(), notifier: { notify } });
    await ingress.submit(makeRequest());
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify on a deny outcome", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ingress = buildIngress({ decision: denyDecision(), notifier: { notify } });
    await ingress.submit(makeRequest());
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify on the legacy no-lifecycle park (nothing a tap could act on)", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ingress = buildIngress({
      decision: requireApprovalDecision(),
      notifier: { notify },
      withLifecycle: false,
    });
    const res = await ingress.submit(makeRequest());
    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(notify).not.toHaveBeenCalled();
  });

  it("parks identically when no notifier is configured", async () => {
    const ingress = buildIngress({ decision: requireApprovalDecision() });
    const res = await ingress.submit(makeRequest());
    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(res.lifecycleId).toBeDefined();
    expect(res.bindingHash).toBeDefined();
  });

  it("a rejecting notifier is logged and never breaks the park", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notify = vi.fn().mockRejectedValue(new Error("slack down"));
    const ingress = buildIngress({ decision: requireApprovalDecision(), notifier: { notify } });

    const res = await ingress.submit(makeRequest());

    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(res.lifecycleId).toBeDefined();
    // The fire is intentionally not awaited by submit; wait for the catch leg.
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "[PlatformIngress] approval notification failed",
        expect.anything(),
      );
    });
  });

  it("a synchronously-throwing notifier is logged and never breaks the park", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifier: ApprovalNotifier = {
      notify: () => {
        throw new Error("sync explosion");
      },
    };
    const ingress = buildIngress({ decision: requireApprovalDecision(), notifier });

    const res = await ingress.submit(makeRequest());

    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(res.lifecycleId).toBeDefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "[PlatformIngress] approval notification failed",
      expect.anything(),
    );
  });
});
