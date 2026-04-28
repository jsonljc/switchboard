import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { BillingEntitlementResolver, OrganizationEntitlement } from "../../billing/index.js";
import type { CanonicalSubmitRequest } from "../canonical-request.js";

function makeRequest(overrides: Partial<CanonicalSubmitRequest> = {}): CanonicalSubmitRequest {
  return {
    organizationId: "org_test",
    actor: { id: "actor_1", type: "user" },
    intent: "noop.intent",
    parameters: {},
    trigger: "api",
    surface: { surface: "api" },
    ...overrides,
  };
}

function buildIngress(opts: { resolver?: BillingEntitlementResolver }): PlatformIngress {
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
    governanceGate: {
      evaluate: async () => ({
        outcome: "execute" as const,
        reasonCode: "OK",
        riskScore: 0,
        matchedPolicies: [],
        budgetProfile: "standard",
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
          config: {},
          trustLevel: "guided",
          trustScore: 0,
        }) as never,
    },
    entitlementResolver: opts.resolver,
  });
}

function entitled(): OrganizationEntitlement {
  return { entitled: true, reason: "active" };
}

function blocked(blockedStatus: string): OrganizationEntitlement {
  return { entitled: false, reason: "blocked", blockedStatus };
}

describe("PlatformIngress entitlement enforcement", () => {
  it("rejects blocked orgs with entitlement_required", async () => {
    const resolveSpy = vi.fn(async () => blocked("canceled"));
    const ingress = buildIngress({ resolver: { resolve: resolveSpy } });

    const result = await ingress.submit(makeRequest());

    expect(resolveSpy).toHaveBeenCalledWith("org_test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("entitlement_required");
      expect(result.error.intent).toBe("noop.intent");
      if (result.error.type === "entitlement_required") {
        expect(result.error.blockedStatus).toBe("canceled");
      }
    }
  });

  it("allows active orgs through to execution", async () => {
    const ingress = buildIngress({ resolver: { resolve: async () => entitled() } });
    const result = await ingress.submit(makeRequest());
    expect(result.ok).toBe(true);
  });

  it("allows orgs with reason=override even when underlying status is canceled", async () => {
    const ingress = buildIngress({
      resolver: { resolve: async () => ({ entitled: true, reason: "override" as const }) },
    });
    const result = await ingress.submit(makeRequest());
    expect(result.ok).toBe(true);
  });

  it("skips entitlement check when no resolver is configured", async () => {
    const ingress = buildIngress({});
    const result = await ingress.submit(makeRequest());
    expect(result.ok).toBe(true);
  });

  it("propagates resolver errors instead of swallowing them", async () => {
    const resolver: BillingEntitlementResolver = {
      resolve: async () => {
        throw new Error("upstream resolver failure");
      },
    };
    const ingress = buildIngress({ resolver });

    await expect(ingress.submit(makeRequest())).rejects.toThrow("upstream resolver failure");
  });
});
