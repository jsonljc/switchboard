import { describe, it, expect, vi } from "vitest";
import { ConversationRouter } from "../conversation-router.js";
import { createEventEnvelope } from "../events.js";
import type { LifecycleStage } from "../lifecycle.js";

function makeStore(stages: Record<string, LifecycleStage>) {
  return {
    getStage: vi.fn(
      async (contactId: string): Promise<LifecycleStage | undefined> => stages[contactId] ?? "lead",
    ),
  };
}

describe("ConversationRouter", () => {
  it("stamps targetAgentId=lead-responder for lead stage contacts", async () => {
    const store = makeStore({ c1: "lead" });
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
    });

    const result = await router.transform(event);
    expect(result.metadata?.targetAgentId).toBe("lead-responder");
    expect(store.getStage).toHaveBeenCalledWith("c1");
  });

  it("stamps targetAgentId=sales-closer for qualified stage contacts", async () => {
    const store = makeStore({ c1: "qualified" });
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
    });

    const result = await router.transform(event);
    expect(result.metadata?.targetAgentId).toBe("sales-closer");
  });

  it("emits escalation for booked/treated/churned contacts", async () => {
    const store = makeStore({ c1: "booked" });
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
    });

    const result = await router.transform(event);
    expect(result.metadata?.escalateToOwner).toBe(true);
    expect(result.metadata?.targetAgentId).toBeUndefined();
  });

  it("defaults unknown contacts to lead-responder", async () => {
    const store = makeStore({});
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "unknown" },
    });

    const result = await router.transform(event);
    expect(result.metadata?.targetAgentId).toBe("lead-responder");
  });

  it("passes through non-message.received events unchanged", async () => {
    const store = makeStore({});
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const result = await router.transform(event);
    expect(result).toBe(event); // exact same reference
    expect(store.getStage).not.toHaveBeenCalled();
  });
});
