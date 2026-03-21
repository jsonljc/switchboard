import { describe, it, expect, vi } from "vitest";
import { SalesCloserHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import type { SalesCloserDeps } from "../types.js";
import type { ConversationStore, LLMReply } from "@switchboard/core";
import type { KnowledgeRetriever } from "../../../knowledge/retrieval.js";

function makeMockLLM(reply = "Great choice! Book here: https://cal.com/book", confidence = 0.9) {
  return {
    generateReply: vi.fn().mockResolvedValue({
      reply,
      confidence,
    } satisfies LLMReply),
  };
}

function makeMockRetriever() {
  return {
    retrieve: vi.fn().mockResolvedValue([
      {
        chunkId: "ch1",
        content: "Botox treatment info",
        similarity: 0.85,
        sourceType: "document",
      },
    ]),
  } as unknown as KnowledgeRetriever;
}

function makeMockConversationStore(history: unknown[] = []): ConversationStore {
  return {
    getHistory: vi.fn().mockResolvedValue(history),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    getStage: vi.fn().mockResolvedValue("qualified"),
    setStage: vi.fn().mockResolvedValue(undefined),
    isOptedOut: vi.fn().mockResolvedValue(false),
    setOptOut: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(overrides: Partial<SalesCloserDeps> = {}): SalesCloserDeps {
  return {
    conversation: {
      llm: makeMockLLM(),
      retriever: makeMockRetriever(),
      conversationStore: makeMockConversationStore(),
    },
    ...overrides,
  };
}

function makeMessageEvent() {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "message.received",
    source: { type: "webhook", id: "whatsapp" },
    payload: { contactId: "c1", messageText: "I'm interested in Botox" },
  });
}

describe("SalesCloserHandler — conversation flow", () => {
  it("sends LLM reply via WhatsApp when conversation deps provided", async () => {
    const deps = makeDeps();
    const handler = new SalesCloserHandler(deps);
    const event = makeMessageEvent();

    const result = await handler.handle(
      event,
      { bookingUrl: "https://cal.com/book" },
      { organizationId: "org-1", profile: { booking: { bookingUrl: "https://cal.com/book" } } },
    );

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "messaging.whatsapp.send",
          parameters: expect.objectContaining({ contactId: "c1" }),
        }),
      ]),
    );
    expect(result.state).toEqual(
      expect.objectContaining({ confidence: expect.any(Number), reply: expect.any(String) }),
    );
  });

  it("escalates on low confidence", async () => {
    const deps = makeDeps({
      conversation: {
        llm: makeMockLLM("I'm not sure", 0.2),
        retriever: {
          retrieve: vi
            .fn()
            .mockResolvedValue([
              { chunkId: "ch1", content: "info", similarity: 0.3, sourceType: "document" },
            ]),
        } as unknown as KnowledgeRetriever,
        conversationStore: makeMockConversationStore(),
      },
    });
    const handler = new SalesCloserHandler(deps);
    const event = makeMessageEvent();

    const result = await handler.handle(
      event,
      { bookingUrl: "https://cal.com/book" },
      { organizationId: "org-1", profile: { booking: { bookingUrl: "https://cal.com/book" } } },
    );

    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "conversation.escalated",
          payload: expect.objectContaining({ reason: "low_confidence" }),
        }),
      ]),
    );
    expect(result.actions).toHaveLength(0);
  });

  it("escalates when max turns exceeded", async () => {
    const longHistory = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i}`,
      contactId: "c1",
      direction: "inbound" as const,
      content: `message ${i}`,
      timestamp: new Date().toISOString(),
      channel: "whatsapp" as const,
    }));
    const deps = makeDeps({
      conversation: {
        llm: makeMockLLM(),
        retriever: makeMockRetriever(),
        conversationStore: makeMockConversationStore(longHistory),
      },
    });
    const handler = new SalesCloserHandler(deps);
    const event = makeMessageEvent();

    const result = await handler.handle(
      event,
      { bookingUrl: "https://cal.com/book", maxTurnsBeforeEscalation: 10 },
      { organizationId: "org-1", profile: { booking: { bookingUrl: "https://cal.com/book" } } },
    );

    expect(result.events[0]!.eventType).toBe("conversation.escalated");
    expect(result.events[0]!.payload).toEqual(
      expect.objectContaining({ reason: "max_turns_exceeded" }),
    );
  });

  it("delegates to Nurture via cadence.start when Nurture is active", async () => {
    const deps = makeDeps({ isAgentActive: vi.fn().mockReturnValue(true) });
    const handler = new SalesCloserHandler(deps);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.qualified",
      source: { type: "agent", id: "lead-responder" },
      payload: { contactId: "c1", score: 80, tier: "hot" },
    });

    const result = await handler.handle(
      event,
      { bookingUrl: "https://cal.com/book", followUpDays: [1, 3, 7] },
      { organizationId: "org-1", profile: { booking: { bookingUrl: "https://cal.com/book" } } },
    );

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.cadence.start",
          parameters: expect.objectContaining({
            contactId: "c1",
            cadenceType: "sales-followup",
          }),
        }),
      ]),
    );
  });

  it("falls back to direct booking link resend when Nurture is not active", async () => {
    const deps = makeDeps({ isAgentActive: vi.fn().mockReturnValue(false) });
    const handler = new SalesCloserHandler(deps);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.qualified",
      source: { type: "agent", id: "lead-responder" },
      payload: { contactId: "c1", score: 80, tier: "hot" },
    });

    const result = await handler.handle(
      event,
      { bookingUrl: "https://cal.com/book", followUpDays: [1, 3, 7] },
      { organizationId: "org-1", profile: { booking: { bookingUrl: "https://cal.com/book" } } },
    );

    // Should use messaging.whatsapp.send directly instead of cadence.start
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "messaging.whatsapp.send",
          parameters: expect.objectContaining({
            contactId: "c1",
          }),
        }),
      ]),
    );
    expect(result.actions.some((a) => a.actionType === "customer-engagement.cadence.start")).toBe(
      false,
    );
  });

  it("falls back to deterministic booking when no conversation deps", async () => {
    const handler = new SalesCloserHandler({});
    const event = makeMessageEvent();

    const result = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: { bookingUrl: "https://cal.com/book" } },
      },
    );

    expect(result.events.some((e) => e.eventType === "stage.advanced")).toBe(true);
  });
});
