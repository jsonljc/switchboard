import { describe, it, expect } from "vitest";
import { bootstrapAgentSystem, registerAgentsForOrg } from "../agent-bootstrap.js";
import type { ConversionBus } from "@switchboard/core";

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
