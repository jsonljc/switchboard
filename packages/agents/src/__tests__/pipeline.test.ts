import { describe, it, expect, vi } from "vitest";
import { AgentRegistry } from "../registry.js";
import { AgentRouter } from "../router.js";
import { PolicyBridge } from "../policy-bridge.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import { Dispatcher } from "../dispatcher.js";
import { createEventEnvelope } from "../events.js";

describe("Full Pipeline: event → route → policy → dispatch → delivery", () => {
  it("routes lead.received to lead-responder and tracks delivery", async () => {
    // 1. Registry: lead-responder is hired and active
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: { autoQualify: true },
      capabilities: {
        accepts: ["lead.received"],
        emits: ["lead.qualified", "lead.disqualified"],
        tools: ["qualify_lead"],
      },
    });

    // 2. Router: resolve destinations
    const router = new AgentRouter(registry, {
      webhooks: [
        {
          id: "slack-notification",
          url: "https://hooks.slack.com/xxx",
          subscribedEvents: ["lead.received"],
          criticality: "best_effort",
          enabled: true,
        },
      ],
    });

    // 3. Policy bridge: permissive
    const bridge = new PolicyBridge(null);

    // 4. Delivery store
    const store = new InMemoryDeliveryStore();

    // 5. Handlers
    const agentHandler = vi.fn().mockResolvedValue({ success: true });
    const webhookHandler = vi.fn().mockResolvedValue({ success: true });

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: {
        agent: agentHandler,
        webhook: webhookHandler,
      },
    });

    // 6. Emit event
    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1", message: "Hi, interested in teeth whitening" },
      attribution: {
        fbclid: "fb-abc123",
        gclid: null,
        ttclid: null,
        sourceCampaignId: "camp-spring-2026",
        sourceAdId: "ad-whitening-01",
        utmSource: "meta",
        utmMedium: "paid",
        utmCampaign: "spring-promo",
      },
    });

    // 7. Route
    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(2);

    // 8. Dispatch
    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "succeeded")).toBe(true);

    // 9. Verify agent handler received the event with attribution
    expect(agentHandler).toHaveBeenCalledWith(event, "lead-responder");
    expect(event.attribution?.sourceCampaignId).toBe("camp-spring-2026");

    // 10. Verify delivery store recorded both
    const deliveries = await store.getByEvent(event.eventId);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === "succeeded")).toBe(true);
  });

  it("routes to manual_queue when no agents are hired", async () => {
    const registry = new AgentRegistry();
    const router = new AgentRouter(registry);
    const bridge = new PolicyBridge(null);
    const store = new InMemoryDeliveryStore();
    const manualHandler = vi.fn().mockResolvedValue({ success: true });

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { manual_queue: manualHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("manual_queue");

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(1);
    expect(manualHandler).toHaveBeenCalled();
  });
});
