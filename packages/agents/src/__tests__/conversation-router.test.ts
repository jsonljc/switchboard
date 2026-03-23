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

describe("ConversationRouter with threadStore", () => {
  it("loads existing thread and attaches to metadata", async () => {
    const existingThread = {
      id: "t-1",
      contactId: "c-1",
      organizationId: "org-1",
      stage: "qualifying" as const,
      assignedAgent: "lead-responder",
      agentContext: {
        objectionsEncountered: [],
        preferencesLearned: {},
        offersMade: [],
        topicsDiscussed: [],
        sentimentTrend: "unknown" as const,
      },
      currentSummary: "",
      followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
      lastOutcomeAt: null,
      messageCount: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const threadStore = {
      getByContact: vi.fn().mockResolvedValue(existingThread),
      create: vi.fn(),
      update: vi.fn(),
    };

    const router = new ConversationRouter({
      getStage: async () => "lead",
      threadStore,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c-1" },
    });
    const result = await router.transform(event);

    expect(result.metadata?.conversationThread).toEqual(existingThread);
    expect(result.metadata?.targetAgentId).toBe("lead-responder");
    expect(threadStore.getByContact).toHaveBeenCalledWith("c-1", "org-1");
  });

  it("creates a new thread when none exists", async () => {
    const threadStore = {
      getByContact: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    };

    const router = new ConversationRouter({
      getStage: async () => undefined,
      threadStore,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c-1" },
    });
    const result = await router.transform(event);

    expect(threadStore.create).toHaveBeenCalled();
    expect(result.metadata?.conversationThread).toBeDefined();
    const thread = result.metadata!.conversationThread as { stage: string };
    expect(thread.stage).toBe("new");
  });

  it("routes based on thread stage when thread exists", async () => {
    const threadStore = {
      getByContact: vi.fn().mockResolvedValue({
        id: "t-1",
        contactId: "c-1",
        organizationId: "org-1",
        stage: "qualified",
        assignedAgent: "sales-closer",
        agentContext: {
          objectionsEncountered: [],
          preferencesLearned: {},
          offersMade: [],
          topicsDiscussed: [],
          sentimentTrend: "unknown",
        },
        currentSummary: "",
        followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
        lastOutcomeAt: null,
        messageCount: 8,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      create: vi.fn(),
      update: vi.fn(),
    };

    const router = new ConversationRouter({
      getStage: async () => "lead",
      threadStore,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c-1" },
    });
    const result = await router.transform(event);

    expect(result.metadata?.targetAgentId).toBe("sales-closer");
  });
});
