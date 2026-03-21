import { describe, it, expect, vi } from "vitest";
import { NurtureAgentHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import type { NurtureDeps } from "../types.js";
import type { ConversationStore, LLMReply } from "@switchboard/core";
import type { KnowledgeRetriever } from "../../../knowledge/retrieval.js";

function makeMockConversationStore(optedOut = false): ConversationStore {
  return {
    getHistory: vi.fn().mockResolvedValue([]),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    getStage: vi.fn().mockResolvedValue("booked"),
    setStage: vi.fn().mockResolvedValue(undefined),
    isOptedOut: vi.fn().mockResolvedValue(optedOut),
    setOptOut: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(optedOut = false): NurtureDeps {
  return {
    conversation: {
      llm: {
        generateReply: vi.fn().mockResolvedValue({
          reply: "Your appointment is tomorrow at 2pm!",
          confidence: 0.9,
        } satisfies LLMReply),
      },
      retriever: {
        retrieve: vi.fn().mockResolvedValue([]),
      } as unknown as KnowledgeRetriever,
      conversationStore: makeMockConversationStore(optedOut),
    },
  };
}

describe("NurtureAgentHandler — enhanced", () => {
  it("skips sending when contact is opted out", async () => {
    const deps = makeDeps(true);
    const handler = new NurtureAgentHandler(deps);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "stage.advanced",
      source: { type: "agent", id: "sales-closer" },
      payload: { contactId: "c1", stage: "booking_initiated" },
    });

    const result = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { nurture: { enabledCadences: ["consultation-reminder"] } },
      },
    );

    expect(result.actions).toHaveLength(0);
    expect(result.state).toEqual(expect.objectContaining({ skippedReason: "opted_out" }));
  });

  it("generates LLM cadence message when conversation deps provided", async () => {
    const deps = makeDeps(false);
    const handler = new NurtureAgentHandler(deps);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "stage.advanced",
      source: { type: "agent", id: "sales-closer" },
      payload: { contactId: "c1", stage: "booking_initiated" },
    });

    const result = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { nurture: { enabledCadences: ["consultation-reminder"] } },
      },
    );

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "messaging.whatsapp.send",
          parameters: expect.objectContaining({ contactId: "c1" }),
        }),
      ]),
    );
  });

  it("uses fallback static message when no conversation deps", async () => {
    const handler = new NurtureAgentHandler({});

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "stage.advanced",
      source: { type: "agent", id: "sales-closer" },
      payload: { contactId: "c1", stage: "booking_initiated" },
    });

    const result = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { nurture: { enabledCadences: ["consultation-reminder"] } },
      },
    );

    expect(result.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ actionType: "messaging.whatsapp.send" })]),
    );
  });

  it("maps post-treatment-review from revenue.recorded", async () => {
    const deps = makeDeps(false);
    const handler = new NurtureAgentHandler(deps);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "agent", id: "revenue-tracker" },
      payload: { contactId: "c1", amount: 200 },
    });

    const result = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          nurture: {
            enabledCadences: ["post-treatment-review"],
            reviewPlatformLink: "https://g.page/clinic",
            reviewDelayDays: 7,
          },
        },
      },
    );

    expect(result.actions.some((a) => a.actionType === "messaging.whatsapp.send")).toBe(true);
  });

  it("includes review platform link in cadence parameters", async () => {
    // Use fallback path (no LLM deps) — review link is appended to static message
    const handler = new NurtureAgentHandler({});

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "agent", id: "revenue-tracker" },
      payload: { contactId: "c1", amount: 200 },
    });

    const result = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          nurture: {
            enabledCadences: ["post-treatment-review"],
            reviewPlatformLink: "https://g.page/clinic",
          },
        },
      },
    );

    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect((sendAction?.parameters.content as string) ?? "").toContain("https://g.page/clinic");
  });
});
