import { describe, it, expect } from "vitest";
import { AgentRouter } from "../router.js";
import { AgentRegistry } from "../registry.js";
import { createEventEnvelope } from "../events.js";
import type { WebhookDestinationConfig, ConnectorDestinationConfig } from "../route-plan.js";

describe("AgentRouter", () => {
  function buildRegistry(): AgentRegistry {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "employee-a",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["lead.received"],
        emits: ["lead.qualified", "lead.disqualified"],
        tools: ["qualify_lead"],
      },
    });
    registry.register("org-1", {
      agentId: "employee-b",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["lead.qualified"],
        emits: ["stage.advanced"],
        tools: ["book_appointment"],
      },
    });
    return registry;
  }

  it("routes to hired agent that accepts the event", () => {
    const registry = buildRegistry();
    const router = new AgentRouter(registry);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("agent");
    expect(plan.destinations[0]!.id).toBe("employee-a");
    expect(plan.destinations[0]!.criticality).toBe("required");
  });

  it("routes to webhook when no agent accepts the event", () => {
    const registry = new AgentRegistry();
    const webhooks: WebhookDestinationConfig[] = [
      {
        id: "hubspot-hook",
        url: "https://hooks.hubspot.com/abc",
        subscribedEvents: ["lead.received"],
        criticality: "required",
        enabled: true,
      },
    ];
    const router = new AgentRouter(registry, { webhooks });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "intake" },
      payload: {},
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("webhook");
    expect(plan.destinations[0]!.id).toBe("hubspot-hook");
  });

  it("fans out to both agent and webhook", () => {
    const registry = buildRegistry();
    const webhooks: WebhookDestinationConfig[] = [
      {
        id: "analytics-hook",
        url: "https://analytics.example.com/events",
        subscribedEvents: ["lead.received"],
        criticality: "best_effort",
        enabled: true,
      },
    ];
    const router = new AgentRouter(registry, { webhooks });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: {},
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(2);

    const agentDest = plan.destinations.find((d) => d.type === "agent");
    const webhookDest = plan.destinations.find((d) => d.type === "webhook");
    expect(agentDest).toBeDefined();
    expect(webhookDest).toBeDefined();
    expect(webhookDest!.criticality).toBe("best_effort");
  });

  it("routes to manual_queue when no destination matches", () => {
    const registry = new AgentRegistry();
    const router = new AgentRouter(registry);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: {},
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("manual_queue");
  });

  it("skips disabled webhooks", () => {
    const registry = new AgentRegistry();
    const webhooks: WebhookDestinationConfig[] = [
      {
        id: "disabled-hook",
        url: "https://example.com",
        subscribedEvents: ["lead.received"],
        criticality: "required",
        enabled: false,
      },
    ];
    const router = new AgentRouter(registry, { webhooks });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("manual_queue");
  });

  it("filters webhooks by organizationId when set", () => {
    const registry = new AgentRegistry();
    const webhooks: WebhookDestinationConfig[] = [
      {
        id: "org1-hook",
        url: "https://hooks.example.com/org1",
        subscribedEvents: ["lead.received"],
        criticality: "required",
        enabled: true,
        organizationId: "org-1",
      },
      {
        id: "org2-hook",
        url: "https://hooks.example.com/org2",
        subscribedEvents: ["lead.received"],
        criticality: "required",
        enabled: true,
        organizationId: "org-2",
      },
      {
        id: "global-hook",
        url: "https://hooks.example.com/global",
        subscribedEvents: ["lead.received"],
        criticality: "best_effort",
        enabled: true,
        // no organizationId — matches all
      },
    ];
    const router = new AgentRouter(registry, { webhooks });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const plan = router.resolve(event);
    const hookIds = plan.destinations.filter((d) => d.type === "webhook").map((d) => d.id);
    expect(hookIds).toContain("org1-hook");
    expect(hookIds).toContain("global-hook");
    expect(hookIds).not.toContain("org2-hook");
  });

  it("filters connectors by organizationId when set", () => {
    const registry = new AgentRegistry();
    const connectors: ConnectorDestinationConfig[] = [
      {
        id: "org1-connector",
        connectorType: "hubspot",
        subscribedEvents: ["lead.qualified"],
        criticality: "required",
        enabled: true,
        config: {},
        organizationId: "org-1",
      },
      {
        id: "org2-connector",
        connectorType: "hubspot",
        subscribedEvents: ["lead.qualified"],
        criticality: "required",
        enabled: true,
        config: {},
        organizationId: "org-2",
      },
    ];
    const router = new AgentRouter(registry, { connectors });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.qualified",
      source: { type: "agent", id: "employee-a" },
      payload: {},
    });

    const plan = router.resolve(event);
    const connIds = plan.destinations.filter((d) => d.type === "connector").map((d) => d.id);
    expect(connIds).toEqual(["org1-connector"]);
  });

  describe("agent sequencing", () => {
    it("assigns parallel sequencing to all agent destinations", () => {
      const registry = new AgentRegistry();
      registry.register("org-1", {
        agentId: "employee-c",
        version: "0.1.0",
        installed: true,
        status: "active",
        config: {},
        capabilities: {
          accepts: ["revenue.recorded", "stage.advanced", "ad.optimized"],
          emits: ["revenue.updated"],
          tools: ["log_revenue"],
        },
      });
      registry.register("org-1", {
        agentId: "employee-d",
        version: "0.1.0",
        installed: true,
        status: "active",
        config: {},
        capabilities: {
          accepts: ["stage.advanced", "lead.disqualified", "revenue.recorded"],
          emits: ["nurture.sent"],
          tools: ["send_nurture"],
        },
      });

      const router = new AgentRouter(registry);
      const event = createEventEnvelope({
        organizationId: "org-1",
        eventType: "stage.advanced",
        source: { type: "agent", id: "employee-b" },
        payload: {},
      });

      const plan = router.resolve(event);
      for (const dest of plan.destinations) {
        expect(dest.sequencing).toBe("parallel");
      }
    });
  });

  it("includes connector destinations", () => {
    const registry = new AgentRegistry();
    const connectors: ConnectorDestinationConfig[] = [
      {
        id: "hubspot-connector",
        connectorType: "hubspot",
        subscribedEvents: ["lead.qualified"],
        criticality: "required",
        enabled: true,
        config: { apiKey: "xxx" },
      },
    ];
    const router = new AgentRouter(registry, { connectors });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.qualified",
      source: { type: "agent", id: "employee-a" },
      payload: {},
    });

    const plan = router.resolve(event);
    const connDest = plan.destinations.find((d) => d.type === "connector");
    expect(connDest).toBeDefined();
    expect(connDest!.id).toBe("hubspot-connector");
  });
});
