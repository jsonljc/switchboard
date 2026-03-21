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
      agentId: "revenue-tracker",
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
      agentId: "nurture",
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
      "revenue-tracker",
      makeHandler(() => {
        executionOrder.push("revenue-tracker");
        return { events: [], actions: [] };
      }),
    );
    handlerRegistry.register(
      "nurture",
      makeHandler(() => {
        executionOrder.push("nurture");
        return { events: [], actions: [] };
      }),
    );

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
      eventType: "stage.advanced",
      source: { type: "agent", id: "sales-closer" },
      payload: { contactId: "c1" },
    });

    await loop.process(event, { organizationId: "org-1" });

    expect(executionOrder).toEqual(["revenue-tracker", "nurture"]);
  });

  it("skips parallel destinations when required blocking destination fails", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "revenue-tracker",
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
      agentId: "nurture",
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
    const revenueHandler = makeFailingHandler("CAPI timeout");
    const nurtureHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("revenue-tracker", revenueHandler);
    handlerRegistry.register("nurture", nurtureHandler);

    const deliveryStore = new InMemoryDeliveryStore();
    const loop = new EventLoop({
      router: new AgentRouter(agentRegistry),
      registry: agentRegistry,
      handlers: handlerRegistry,
      actionExecutor: new ActionExecutor(),
      policyBridge: new PolicyBridge(null),
      deliveryStore,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "stage.advanced",
      source: { type: "agent", id: "sales-closer" },
      payload: { contactId: "c1" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    // Revenue tracker processed but failed
    const revResult = result.processed.find((p) => p.agentId === "revenue-tracker");
    expect(revResult).toBeDefined();
    expect(revResult!.success).toBe(false);

    // Nurture handler was NOT called
    expect(nurtureHandler.handle).not.toHaveBeenCalled();
  });

  it("skips after_success destinations when dependency did not succeed", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "revenue-tracker",
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
      agentId: "nurture",
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
    const revenueHandler = makeFailingHandler("CAPI timeout");
    const nurtureHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlerRegistry.register("revenue-tracker", revenueHandler);
    handlerRegistry.register("nurture", nurtureHandler);

    // Custom router that returns after_success for nurture
    const customRouter = {
      resolve: (event: RoutedEventEnvelope) => ({
        event,
        destinations: [
          {
            type: "agent" as const,
            id: "revenue-tracker",
            criticality: "required" as const,
            sequencing: "blocking" as const,
          },
          {
            type: "agent" as const,
            id: "nurture",
            criticality: "required" as const,
            sequencing: "after_success" as const,
            afterDestinationId: "revenue-tracker",
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
      source: { type: "agent", id: "sales-closer" },
      payload: { contactId: "c1" },
    });

    await loop.process(event, { organizationId: "org-1" });

    // Nurture should NOT be called because revenue-tracker failed
    expect(nurtureHandler.handle).not.toHaveBeenCalled();
  });

  it("executes after_success destinations when dependency succeeds", async () => {
    const executionOrder: string[] = [];

    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "revenue-tracker",
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
      agentId: "nurture",
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
      "revenue-tracker",
      makeHandler(() => {
        executionOrder.push("revenue-tracker");
        return { events: [], actions: [] };
      }),
    );
    handlerRegistry.register(
      "nurture",
      makeHandler(() => {
        executionOrder.push("nurture");
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
            id: "revenue-tracker",
            criticality: "required" as const,
            sequencing: "blocking" as const,
          },
          {
            type: "agent" as const,
            id: "nurture",
            criticality: "required" as const,
            sequencing: "after_success" as const,
            afterDestinationId: "revenue-tracker",
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
      source: { type: "agent", id: "sales-closer" },
      payload: { contactId: "c1" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(2);
    expect(executionOrder).toEqual(["revenue-tracker", "nurture"]);
  });

  it("does not skip parallel destinations when non-stage.advanced events have no blocking dests", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register("org-1", {
      agentId: "lead-responder",
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
    handlerRegistry.register("lead-responder", leadHandler);

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
    expect(result.processed[0]!.agentId).toBe("lead-responder");
    expect(leadHandler.handle).toHaveBeenCalledTimes(1);
  });
});
