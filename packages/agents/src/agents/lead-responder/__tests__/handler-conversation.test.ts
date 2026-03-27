import { describe, it, expect, vi } from "vitest";
import { LeadResponderHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import type { LeadResponderConversationDeps } from "../types.js";
import type { LLMAdapter, ConversationStore, Message } from "@switchboard/core";
import type { KnowledgeRetriever } from "../../../knowledge/retrieval.js";

function makeConversationDeps(
  overrides: Partial<LeadResponderConversationDeps> = {},
): LeadResponderConversationDeps {
  const mockStore: ConversationStore = {
    getHistory: vi.fn().mockResolvedValue([]),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    getStage: vi.fn().mockResolvedValue("lead"),
    setStage: vi.fn().mockResolvedValue(undefined),
    isOptedOut: vi.fn().mockResolvedValue(false),
    setOptOut: vi.fn().mockResolvedValue(undefined),
  };

  const mockLLM: LLMAdapter = {
    generateReply: vi.fn().mockResolvedValue({
      reply: "Thanks for your interest! We offer a range of treatments. What are you looking for?",
      confidence: 0.85,
    }),
  };

  const mockRetriever = {
    retrieve: vi.fn().mockResolvedValue([
      {
        content: "We offer Botox, fillers, and facials.",
        sourceType: "document" as const,
        similarity: 0.9,
      },
    ]),
  } as unknown as KnowledgeRetriever;

  return {
    llm: mockLLM,
    retriever: mockRetriever,
    conversationStore: mockStore,
    ...overrides,
  };
}

function makeMessageReceivedEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "message.received",
    source: { type: "webhook", id: "whatsapp" },
    payload: {
      contactId: "c1",
      messageText: "What treatments do you offer?",
      ...payload,
    },
  });
}

describe("LeadResponderHandler — LLM conversation flow", () => {
  it("generates LLM reply for message.received when conversation deps present", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect(sendAction).toBeDefined();
    expect(sendAction!.parameters.content).toContain("Thanks for your interest");

    expect(convDeps.llm.generateReply).toHaveBeenCalledOnce();

    expect(convDeps.retriever.retrieve).toHaveBeenCalledWith(
      "What treatments do you offer?",
      expect.objectContaining({ organizationId: "org-1", agentId: "lead-responder" }),
    );
  });

  it("retrieves conversation history from store", async () => {
    const existingHistory: Message[] = [
      {
        id: "m1",
        contactId: "c1",
        direction: "inbound",
        content: "Hi",
        timestamp: "2026-03-21T00:00:00Z",
        channel: "whatsapp",
      },
      {
        id: "m2",
        contactId: "c1",
        direction: "outbound",
        content: "Hello!",
        timestamp: "2026-03-21T00:00:01Z",
        channel: "whatsapp",
      },
    ];

    const convDeps = makeConversationDeps({
      conversationStore: {
        getHistory: vi.fn().mockResolvedValue(existingHistory),
        appendMessage: vi.fn().mockResolvedValue(undefined),
        getStage: vi.fn().mockResolvedValue("lead"),
        setStage: vi.fn().mockResolvedValue(undefined),
        isOptedOut: vi.fn().mockResolvedValue(false),
        setOptOut: vi.fn().mockResolvedValue(undefined),
      },
    });

    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, {}, { organizationId: "org-1" });

    expect(convDeps.llm.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationHistory: expect.arrayContaining([
          expect.objectContaining({ content: "Hi" }),
          expect.objectContaining({ content: "Hello!" }),
        ]),
      }),
    );
  });

  it("appends inbound and outbound messages to conversation store", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, {}, { organizationId: "org-1" });

    expect(convDeps.conversationStore.appendMessage).toHaveBeenCalledTimes(2);

    expect(convDeps.conversationStore.appendMessage).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        direction: "inbound",
        content: "What treatments do you offer?",
      }),
    );

    expect(convDeps.conversationStore.appendMessage).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ direction: "outbound" }),
    );
  });

  it("escalates when confidence below threshold", async () => {
    const convDeps = makeConversationDeps({
      llm: {
        generateReply: vi.fn().mockResolvedValue({ reply: "I'm not sure...", confidence: 0.3 }),
      },
      retriever: {
        retrieve: vi
          .fn()
          .mockResolvedValue([
            { content: "Some info", sourceType: "document" as const, similarity: 0.5 },
          ]),
      } as unknown as KnowledgeRetriever,
    });

    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(
      event,
      { confidenceThreshold: 0.6 },
      { organizationId: "org-1" },
    );

    const escalation = result.events.find((e) => e.eventType === "conversation.escalated");
    expect(escalation).toBeDefined();
    expect(escalation!.payload).toEqual(expect.objectContaining({ reason: "low_confidence" }));

    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect(sendAction).toBeUndefined();
  });

  it("runs scoreLead and emits lead.qualified when score >= threshold", async () => {
    const scoreFn = vi.fn().mockReturnValue({ score: 75, tier: "hot", factors: [] });
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: scoreFn,
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent({
      messageText: "I really want Botox, what's the cost? I can come in this week.",
    });
    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(scoreFn).toHaveBeenCalled();

    const qualified = result.events.find((e) => e.eventType === "lead.qualified");
    expect(qualified).toBeDefined();
  });

  it("transitions contact to qualified stage on qualification", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 75, tier: "hot", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, {}, { organizationId: "org-1" });

    expect(convDeps.conversationStore.setStage).toHaveBeenCalledWith("c1", "qualified");
  });

  it("does not transition stage when score below threshold", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 20, tier: "cold", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, {}, { organizationId: "org-1" });

    expect(convDeps.conversationStore.setStage).not.toHaveBeenCalled();
  });

  it("uses tone preset and language from config", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(
      event,
      { tonePreset: "casual-conversational", language: "en-sg" },
      { organizationId: "org-1" },
    );

    expect(convDeps.llm.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("friend"),
      }),
    );
    expect(convDeps.llm.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("Singlish"),
      }),
    );
  });

  it("escalates when max turns exceeded in conversation", async () => {
    const longHistory: Message[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      contactId: "c1",
      direction: (i % 2 === 0 ? "inbound" : "outbound") as "inbound" | "outbound",
      content: `message ${i}`,
      timestamp: new Date().toISOString(),
      channel: "whatsapp" as const,
    }));

    const convDeps = makeConversationDeps({
      conversationStore: {
        getHistory: vi.fn().mockResolvedValue(longHistory),
        appendMessage: vi.fn().mockResolvedValue(undefined),
        getStage: vi.fn().mockResolvedValue("lead"),
        setStage: vi.fn().mockResolvedValue(undefined),
        isOptedOut: vi.fn().mockResolvedValue(false),
        setOptOut: vi.fn().mockResolvedValue(undefined),
      },
    });

    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(
      event,
      { maxTurnsBeforeEscalation: 10 },
      { organizationId: "org-1" },
    );

    const escalation = result.events.find((e) => e.eventType === "conversation.escalated");
    expect(escalation).toBeDefined();
    expect(escalation!.payload).toEqual(expect.objectContaining({ reason: "max_turns_exceeded" }));
  });

  it("falls back to scoring-only for message.received when no conversation deps", async () => {
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 80, tier: "hot", factors: [] }),
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(result.events[0]!.eventType).toBe("lead.qualified");
    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect(sendAction).toBeUndefined();
  });
});

describe("LeadResponderHandler — test mode", () => {
  it("does not emit messaging.whatsapp.send in test mode", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(event, { mode: "test" }, { organizationId: "org-1" });

    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect(sendAction).toBeUndefined();
  });

  it("does not emit messaging.whatsapp.send in draft mode", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(event, { mode: "draft" }, { organizationId: "org-1" });

    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect(sendAction).toBeUndefined();
  });

  it("stores messages with dashboard channel in test mode", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, { mode: "test" }, { organizationId: "org-1" });

    expect(convDeps.conversationStore.appendMessage).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ channel: "dashboard" }),
    );
  });

  it("still returns reply in state for dashboard display", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(event, { mode: "test" }, { organizationId: "org-1" });

    expect(result.state?.reply).toBeDefined();
    expect(result.state?.reply).toContain("Thanks for your interest");
  });

  it("passes testMode flag to prompt builder", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, { mode: "test" }, { organizationId: "org-1" });

    expect(convDeps.llm.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        agentInstructions: expect.stringContaining("test mode"),
      }),
    );
  });
});

describe("lifecycle integration", () => {
  it("calls advanceOpportunityStage('qualified') when lead qualifies", async () => {
    const mockLifecycle = {
      advanceOpportunityStage: vi.fn().mockResolvedValue(undefined),
      reopenOpportunity: vi.fn().mockResolvedValue(undefined),
    };
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 80, tier: "hot", factors: [] }),
      conversation: convDeps,
    });

    const event = {
      ...makeMessageReceivedEvent(),
      metadata: {
        lifecycleOpportunityId: "opp-1",
        lifecycleContactId: "contact-1",
      },
    };

    await handler.handle(event, {}, { organizationId: "org-1", lifecycle: mockLifecycle });

    expect(mockLifecycle.advanceOpportunityStage).toHaveBeenCalledWith(
      "org-1",
      "opp-1",
      "qualified",
      "lead-responder",
    );
  });

  it("does not call lifecycle when context.lifecycle is undefined", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 80, tier: "hot", factors: [] }),
      conversation: convDeps,
    });

    const event = {
      ...makeMessageReceivedEvent(),
      metadata: { lifecycleOpportunityId: "opp-1" },
    };

    const result = await handler.handle(event, {}, { organizationId: "org-1" });
    expect(result.events.some((e) => e.eventType === "lead.qualified")).toBe(true);
  });

  it("does not call lifecycle when lifecycleOpportunityId is missing", async () => {
    const mockLifecycle = {
      advanceOpportunityStage: vi.fn().mockResolvedValue(undefined),
      reopenOpportunity: vi.fn().mockResolvedValue(undefined),
    };
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 80, tier: "hot", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, {}, { organizationId: "org-1", lifecycle: mockLifecycle });

    expect(mockLifecycle.advanceOpportunityStage).not.toHaveBeenCalled();
  });

  it("continues processing when lifecycle call fails", async () => {
    const mockLifecycle = {
      advanceOpportunityStage: vi.fn().mockRejectedValue(new Error("DB error")),
      reopenOpportunity: vi.fn().mockResolvedValue(undefined),
    };
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 80, tier: "hot", factors: [] }),
      conversation: convDeps,
    });

    const event = {
      ...makeMessageReceivedEvent(),
      metadata: { lifecycleOpportunityId: "opp-1" },
    };

    const result = await handler.handle(
      event,
      {},
      { organizationId: "org-1", lifecycle: mockLifecycle },
    );

    expect(result.events.some((e) => e.eventType === "lead.qualified")).toBe(true);
    expect(result.state?.qualified).toBe(true);
  });

  it("propagates lifecycle metadata to lead.qualified output events", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 80, tier: "hot", factors: [] }),
      conversation: convDeps,
    });

    const event = {
      ...makeMessageReceivedEvent(),
      metadata: {
        lifecycleOpportunityId: "opp-1",
        lifecycleContactId: "contact-1",
      },
    };

    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    const qualifiedEvent = result.events.find((e) => e.eventType === "lead.qualified");
    expect(qualifiedEvent?.metadata?.lifecycleOpportunityId).toBe("opp-1");
    expect(qualifiedEvent?.metadata?.lifecycleContactId).toBe("contact-1");
  });

  it("propagates lifecycle metadata to lead.disqualified output events", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 10, tier: "cold", factors: [] }),
      conversation: convDeps,
    });

    const event = {
      ...makeMessageReceivedEvent(),
      metadata: {
        lifecycleOpportunityId: "opp-1",
        lifecycleContactId: "contact-1",
      },
    };

    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    const disqualifiedEvent = result.events.find((e) => e.eventType === "lead.disqualified");
    expect(disqualifiedEvent?.metadata?.lifecycleOpportunityId).toBe("opp-1");
    expect(disqualifiedEvent?.metadata?.lifecycleContactId).toBe("contact-1");
  });
});

describe("thread integration", () => {
  it("reads thread context from event metadata and returns threadUpdate", async () => {
    const handler = new LeadResponderHandler({
      scoreLead: () => ({ score: 30, tier: "cool", factors: [] }),
      conversation: {
        llm: {
          generateReply: vi
            .fn()
            .mockResolvedValueOnce({ reply: "Hi! How can I help?", confidence: 0.8 })
            .mockResolvedValueOnce({
              reply: JSON.stringify({
                objectionsEncountered: [],
                preferencesLearned: {},
                topicsDiscussed: ["greeting"],
                sentimentTrend: "positive",
                offersMade: [],
              }),
              confidence: 0.9,
            }),
        },
        retriever: {
          retrieve: vi.fn().mockResolvedValue([
            {
              content: "Welcome! We offer various treatments.",
              sourceType: "document",
              similarity: 0.85,
            },
          ]),
        } as unknown as import("../../../knowledge/retrieval.js").KnowledgeRetriever,
        conversationStore: {
          getHistory: vi.fn().mockResolvedValue([]),
          appendMessage: vi.fn(),
          getStage: vi.fn().mockResolvedValue("lead"),
          setStage: vi.fn(),
          isOptedOut: vi.fn().mockResolvedValue(false),
          setOptOut: vi.fn(),
        },
      },
    });

    const event = {
      eventId: "e-1",
      eventType: "message.received",
      organizationId: "org-1",
      occurredAt: new Date().toISOString(),
      source: { type: "webhook", id: "whatsapp" },
      correlationId: "cor-1",
      idempotencyKey: "idem-1",
      payload: { contactId: "c-1", messageText: "Hello" },
      metadata: {
        conversationThread: {
          id: "t-1",
          contactId: "c-1",
          organizationId: "org-1",
          stage: "new",
          assignedAgent: "lead-responder",
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
          messageCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    } as unknown as import("../../../events.js").RoutedEventEnvelope;

    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(result.threadUpdate).toBeDefined();
    expect(result.threadUpdate!.stage).toBe("responding");
    expect(result.threadUpdate!.messageCount).toBe(1);
  });
});
