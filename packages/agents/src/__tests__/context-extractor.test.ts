import { describe, it, expect, vi } from "vitest";
import { extractConversationContext, parseContextResponse } from "../context-extractor.js";
import type { LLMAdapter } from "@switchboard/core";
import type { AgentContextData } from "@switchboard/schemas";
import type { Message } from "@switchboard/core";

describe("parseContextResponse", () => {
  it("parses valid JSON context from LLM reply", () => {
    const raw = JSON.stringify({
      objectionsEncountered: ["too expensive"],
      preferencesLearned: { time: "mornings" },
      topicsDiscussed: ["pricing", "scheduling"],
      sentimentTrend: "positive",
      offersMade: [],
    });

    const result = parseContextResponse(raw);
    expect(result.objectionsEncountered).toEqual(["too expensive"]);
    expect(result.preferencesLearned).toEqual({ time: "mornings" });
    expect(result.sentimentTrend).toBe("positive");
  });

  it("returns defaults for invalid JSON", () => {
    const result = parseContextResponse("not json");
    expect(result.objectionsEncountered).toEqual([]);
    expect(result.sentimentTrend).toBe("unknown");
  });

  it("extracts JSON from markdown code block", () => {
    const raw =
      '```json\n{"objectionsEncountered":["price"],"preferencesLearned":{},"topicsDiscussed":[],"sentimentTrend":"neutral","offersMade":[]}\n```';
    const result = parseContextResponse(raw);
    expect(result.objectionsEncountered).toEqual(["price"]);
  });
});

describe("extractConversationContext", () => {
  it("calls LLM and returns parsed context", async () => {
    const mockLlm: LLMAdapter = {
      generateReply: vi.fn().mockResolvedValue({
        reply: JSON.stringify({
          objectionsEncountered: ["timing"],
          preferencesLearned: { treatment: "botox" },
          topicsDiscussed: ["treatments"],
          sentimentTrend: "positive",
          offersMade: [],
        }),
        confidence: 0.9,
      }),
    };

    const history: Message[] = [
      {
        id: "m-1",
        contactId: "c-1",
        direction: "inbound",
        content: "How much is botox?",
        timestamp: new Date().toISOString(),
        channel: "whatsapp",
      },
      {
        id: "m-2",
        contactId: "c-1",
        direction: "outbound",
        content: "Our botox starts at $300.",
        timestamp: new Date().toISOString(),
        channel: "whatsapp",
      },
    ];

    const existing: AgentContextData = {
      objectionsEncountered: [],
      preferencesLearned: {},
      offersMade: [],
      topicsDiscussed: [],
      sentimentTrend: "unknown",
    };

    const result = await extractConversationContext(mockLlm, history, existing);
    expect(result.objectionsEncountered).toEqual(["timing"]);
    expect(result.preferencesLearned.treatment).toBe("botox");
    expect(mockLlm.generateReply).toHaveBeenCalledOnce();
  });

  it("returns existing context when LLM fails", async () => {
    const mockLlm: LLMAdapter = {
      generateReply: vi.fn().mockRejectedValue(new Error("API error")),
    };

    const existing: AgentContextData = {
      objectionsEncountered: ["price"],
      preferencesLearned: {},
      offersMade: [],
      topicsDiscussed: ["pricing"],
      sentimentTrend: "neutral",
    };

    const result = await extractConversationContext(mockLlm, [], existing);
    expect(result).toEqual(existing);
  });
});
