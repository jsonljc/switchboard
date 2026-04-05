import { describe, it, expect, vi } from "vitest";
import { EventLoop } from "../event-loop.js";
import { AgentRegistry } from "../registry.js";
import { AgentRouter } from "../router.js";
import { PolicyBridge } from "../policy-bridge.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import { HandlerRegistry } from "../handler-registry.js";
import { ActionExecutor } from "../action-executor.js";
import { createEventEnvelope } from "../events.js";
import type { AgentHandler, AgentContext, AgentResponse } from "../ports.js";
import type { RoutedEventEnvelope } from "../events.js";

function makeHandler(fn: (event: RoutedEventEnvelope) => AgentResponse): AgentHandler {
  return {
    handle: vi.fn(
      async (event: RoutedEventEnvelope, _config: Record<string, unknown>, _ctx: AgentContext) =>
        fn(event),
    ),
  };
}

function makeFailingHandler(errorMsg: string): AgentHandler {
  return {
    handle: vi.fn(async () => {
      throw new Error(errorMsg);
    }),
  };
}

describe("EventLoop Destination Sequencing", () => {
  it("executes blocking destinations before parallel ones", async () => {
    const executionOrder: string[] = [];

    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "employee-c",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["stage.advanced"],
        emits: [],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "employee-d",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["stage.advanced"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    handlerRegistry.register(
      "employee-c",
      makeHandler(() => {
        executionOrder.push("employee-c");
        return { events: [], actions: [] };
      }),
    );
    handlerRegistry.register(
      "employee-d",
      makeHandler(() => {
        executionOrder.push("employee-d");
        return { events: [], actions: [] };
      }),
    );

    // Custom router that assigns blocking sequencing to employee-c
    const customRouter = {
      resolve: (event: RoutedEventEnvelope) => ({
        event,
        destinations: [
          {
            type: "agent" as const,
            id: "employee-c",
            criticality: "required" as const,
            sequencing: "blocking" as const,
          },
          {
            type: "agent" as const,
            id: "employee-d",
            criticality: "required" as const,
            sequencing: "parallel" as const,
          },
        ],
      }),
    };

    const loop = new EventLoop({
      router: customRouter as AgentRouter,
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "stage.advanced",
      source: { type: "agent", id: "employee-b" },
      payload: { contactId: "c1" },
    });

    await loop.process(event, { organizationId: "org-1" });

    expect(executionOrder).toEqual(["employee-c", "employee-d"]);
  });

  it("skips parallel destinations when required blocking destination fails", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "employee-c",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["stage.advanced"],
        emits: [],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "employee-d",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["stage.advanced"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    const blockingHandler = makeFailingHandler("CAPI timeout");
    const parallelHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("employee-c", blockingHandler);
    handlerRegistry.register("employee-d", parallelHandler);

    // Custom router that assigns blocking sequencing to employee-c
    const customRouter = {
      resolve: (event: RoutedEventEnvelope) => ({
        event,
        destinations: [
          {
            type: "agent" as const,
            id: "employee-c",
            criticality: "required" as const,
            sequencing: "blocking" as const,
          },
          {
            type: "agent" as const,
            id: "employee-d",
            criticality: "required" as const,
            sequencing: "parallel" as const,
          },
        ],
      }),
    };

    const loop = new EventLoop({
      router: customRouter as AgentRouter,
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "stage.advanced",
      source: { type: "agent", id: "employee-b" },
      payload: { contactId: "c1" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    // Blocking agent processed but failed
    const blockingResult = result.processed.find((p) => p.agentId === "employee-c");
    expect(blockingResult).toBeDefined();
    expect(blockingResult!.success).toBe(false);

    // Parallel handler was NOT called
    expect(parallelHandler.handle).not.toHaveBeenCalled();
  });

  it("skips after_success destinations when dependency did not succeed", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "employee-c",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["stage.advanced"],
        emits: [],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "employee-d",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["stage.advanced"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    const blockingHandler = makeFailingHandler("CAPI timeout");
    const dependentHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("employee-c", blockingHandler);
    handlerRegistry.register("employee-d", dependentHandler);

    // Custom router that returns after_success for employee-d
    const customRouter = {
      resolve: (event: RoutedEventEnvelope) => ({
        event,
        destinations: [
          {
            type: "agent" as const,
            id: "employee-c",
            criticality: "required" as const,
            sequencing: "blocking" as const,
          },
          {
            type: "agent" as const,
            id: "employee-d",
            criticality: "required" as const,
            sequencing: "after_success" as const,
            afterDestinationId: "employee-c",
          },
        ],
      }),
    };

    const loop = new EventLoop({
      router: customRouter as AgentRouter,
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "stage.advanced",
      source: { type: "agent", id: "employee-b" },
      payload: { contactId: "c1" },
    });

    await loop.process(event, { organizationId: "org-1" });

    // employee-d should NOT be called because employee-c failed
    expect(dependentHandler.handle).not.toHaveBeenCalled();
  });

  it("executes after_success destinations when dependency succeeds", async () => {
    const executionOrder: string[] = [];

    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "employee-c",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["stage.advanced"],
        emits: [],
        tools: [],
      },
    });
    agentRegistry.register("org-1", {
      agentId: "employee-d",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["stage.advanced"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    handlerRegistry.register(
      "employee-c",
      makeHandler(() => {
        executionOrder.push("employee-c");
        return { events: [], actions: [] };
      }),
    );
    handlerRegistry.register(
      "employee-d",
      makeHandler(() => {
        executionOrder.push("employee-d");
        return { events: [], actions: [] };
      }),
    );

    // Custom router with after_success
    const customRouter = {
      resolve: (event: RoutedEventEnvelope) => ({
        event,
        destinations: [
          {
            type: "agent" as const,
            id: "employee-c",
            criticality: "required" as const,
            sequencing: "blocking" as const,
          },
          {
            type: "agent" as const,
            id: "employee-d",
            criticality: "required" as const,
            sequencing: "after_success" as const,
            afterDestinationId: "employee-c",
          },
        ],
      }),
    };

    const loop = new EventLoop({
      router: customRouter as AgentRouter,
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "stage.advanced",
      source: { type: "agent", id: "employee-b" },
      payload: { contactId: "c1" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(2);
    expect(executionOrder).toEqual(["employee-c", "employee-d"]);
  });

  it("does not skip parallel destinations when non-stage.advanced events have no blocking dests", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "employee-a",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["lead.received"],
        emits: [],
        tools: [],
      },
    });

    const handlerRegistry = new HandlerRegistry();
    const leadHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("employee-a", leadHandler);

    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore: new InMemoryDeliveryStore(),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.agentId).toBe("employee-a");
    expect(leadHandler.handle).toHaveBeenCalledTimes(1);
  });
});
