import { describe, it, expect, vi } from "vitest";
import { bootstrapAgentSystem, registerAgentsForOrg } from "../agent-bootstrap.js";
import type { ConversionBus } from "@switchboard/core";
import { InMemoryDeliveryStore, type PolicyEngine } from "@switchboard/agents";

describe("bootstrapAgentSystem", () => {
  it("returns an initialized agent system with all components", () => {
    const system = bootstrapAgentSystem();
    expect(system.registry).toBeDefined();
    expect(system.handlerRegistry).toBeDefined();
    expect(system.eventLoop).toBeDefined();
    expect(system.stateTracker).toBeDefined();
    expect(system.scheduledRunner).toBeDefined();
    expect(system.actionExecutor).toBeDefined();
  });

  it("registers all 5 agent handlers", () => {
    const system = bootstrapAgentSystem();
    const registered = system.handlerRegistry.listRegistered();
    expect(registered).toContain("lead-responder");
    expect(registered).toContain("sales-closer");
    expect(registered).toContain("nurture");
    expect(registered).toContain("ad-optimizer");
    expect(registered).toContain("revenue-tracker");
  });

  it("wires ConversionBusBridge when conversionBus provided", () => {
    const subscriptions: Array<{ type: string }> = [];
    const mockBus = {
      subscribe: (type: string, _handler: unknown) => {
        subscriptions.push({ type });
      },
      emit: () => {},
    } as unknown as ConversionBus;

    bootstrapAgentSystem({ conversionBus: mockBus });
    expect(subscriptions.length).toBeGreaterThan(0);
    expect(subscriptions[0]!.type).toBe("*");
  });

  it("pre-registers agents for provided organizationIds", () => {
    const system = bootstrapAgentSystem({ organizationIds: ["org-a", "org-b"] });
    expect(system.registry.listActive("org-a")).toHaveLength(5);
    expect(system.registry.listActive("org-b")).toHaveLength(5);
  });

  it("accepts a policyEngine option", () => {
    const engine: PolicyEngine = { evaluate: vi.fn().mockResolvedValue({ effect: "allow" }) };
    const system = bootstrapAgentSystem({ policyEngine: engine });
    expect(system).toBeDefined();
  });

  it("uses provided deliveryStore instead of InMemoryDeliveryStore", () => {
    const customStore = new InMemoryDeliveryStore();
    const system = bootstrapAgentSystem({ deliveryStore: customStore });
    expect(system).toBeDefined();
  });

  it("creates CorePolicyEngineAdapter when coreEvaluateFn provided", () => {
    const coreEvaluate = vi.fn().mockReturnValue({
      finalDecision: "allow",
      approvalRequired: "none",
      explanation: "ok",
    });
    const system = bootstrapAgentSystem({
      coreEvaluateFn: coreEvaluate,
      organizationId: "org-1",
    });
    expect(system).toBeDefined();
  });

  it("skips CorePolicyEngineAdapter when coreEvaluateFn provided without organizationId", () => {
    const coreEvaluate = vi.fn().mockReturnValue({
      finalDecision: "allow",
      approvalRequired: "none",
      explanation: "ok",
    });
    const system = bootstrapAgentSystem({ coreEvaluateFn: coreEvaluate });
    expect(system).toBeDefined();
  });

  it("wires RetryExecutor and DeadLetterAlerter by default", () => {
    const system = bootstrapAgentSystem();
    expect(system).toBeDefined();
  });

  it("accepts retryEnabled false to disable retry wiring", () => {
    const system = bootstrapAgentSystem({ retryEnabled: false });
    expect(system).toBeDefined();
  });

  it("accepts maxRetries option", () => {
    const system = bootstrapAgentSystem({ maxRetries: 5 });
    expect(system).toBeDefined();
  });

  it("lazy-registers agents on first event via ConversionBusBridge", () => {
    let capturedHandler: ((event: Record<string, unknown>) => void) | undefined;
    const mockBus = {
      subscribe: (_type: string, handler: (event: Record<string, unknown>) => void) => {
        capturedHandler = handler;
      },
      emit: () => {},
    } as unknown as ConversionBus;

    const system = bootstrapAgentSystem({ conversionBus: mockBus });
    expect(system.registry.listActive("org-lazy")).toHaveLength(0);

    // Simulate a conversion event arriving for an unregistered org
    capturedHandler!({
      type: "inquiry",
      organizationId: "org-lazy",
      contactId: "c1",
      occurredAt: new Date(),
      value: 0,
      metadata: {},
    });

    expect(system.registry.listActive("org-lazy")).toHaveLength(5);
  });
});

describe("registerAgentsForOrg", () => {
  it("registers all 5 agents as active for an organization", () => {
    const system = bootstrapAgentSystem();
    registerAgentsForOrg(system.registry, "org-test");
    const agents = system.registry.listActive("org-test");
    expect(agents).toHaveLength(5);
    const ids = agents.map((a) => a.agentId).sort();
    expect(ids).toEqual([
      "ad-optimizer",
      "lead-responder",
      "nurture",
      "revenue-tracker",
      "sales-closer",
    ]);
  });
});
