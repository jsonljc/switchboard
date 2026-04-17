import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeLLMAdapter } from "../claude-llm-adapter.js";
import type { ConversationPrompt, RetrievedChunk } from "@switchboard/core";

const mockComplete = vi.fn();

function createAdapter(): ClaudeLLMAdapter {
  return new ClaudeLLMAdapter({ complete: mockComplete });
}

const basePrompt: ConversationPrompt = {
  systemPrompt: "You are a friendly receptionist.",
  conversationHistory: [],
  retrievedContext: [],
  agentInstructions: "Answer the customer's question about services.",
};

describe("ClaudeLLMAdapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("generates a reply with confidence", async () => {
    mockComplete.mockResolvedValue(
      JSON.stringify({ reply: "We offer Botox and fillers!", confidence: 0.9 }),
    );

    const adapter = createAdapter();
    const result = await adapter.generateReply(basePrompt);

    expect(result.reply).toBe("We offer Botox and fillers!");
    expect(result.confidence).toBe(0.9);
  });

  it("includes retrieved context in the prompt", async () => {
    mockComplete.mockResolvedValue(
      JSON.stringify({ reply: "Yes, Botox is $200.", confidence: 0.85 }),
    );

    const context: RetrievedChunk[] = [
      {
        content: "Botox: $200 per unit",
        sourceType: "document",
        similarity: 0.92,
      },
    ];

    const adapter = createAdapter();
    await adapter.generateReply({ ...basePrompt, retrievedContext: context });

    expect(mockComplete.mock.calls[0]).toBeDefined();
    const callArgs = mockComplete.mock.calls[0]![0] as Array<{ role: string; content: string }>;
    const systemMsg = callArgs.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("Botox: $200 per unit");
  });

  it("includes conversation history in the prompt", async () => {
    mockComplete.mockResolvedValue(JSON.stringify({ reply: "Great question!", confidence: 0.8 }));

    const adapter = createAdapter();
    await adapter.generateReply({
      ...basePrompt,
      conversationHistory: [
        {
          id: "m1",
          contactId: "c1",
          direction: "inbound",
          content: "What services do you offer?",
          timestamp: "2026-03-21T00:00:00Z",
          channel: "whatsapp",
        },
      ],
    });

    expect(mockComplete.mock.calls[0]).toBeDefined();
    const callArgs = mockComplete.mock.calls[0]![0] as Array<{ role: string; content: string }>;
    const userMsg = callArgs.find(
      (m) => m.role === "user" && m.content.includes("What services do you offer?"),
    );
    expect(userMsg).toBeDefined();
  });

  it("clamps confidence to 0-1 range", async () => {
    mockComplete.mockResolvedValue(JSON.stringify({ reply: "test", confidence: 1.5 }));

    const adapter = createAdapter();
    const result = await adapter.generateReply(basePrompt);
    expect(result.confidence).toBe(1.0);
  });

  it("defaults confidence to 0 when LLM returns invalid value", async () => {
    mockComplete.mockResolvedValue(JSON.stringify({ reply: "test", confidence: "invalid" }));

    const adapter = createAdapter();
    const result = await adapter.generateReply(basePrompt);
    expect(result.confidence).toBe(0);
  });

  it("falls back gracefully on malformed JSON", async () => {
    mockComplete.mockResolvedValue("This is not JSON at all");

    const adapter = createAdapter();
    const result = await adapter.generateReply(basePrompt);

    // Should use the raw text as reply with 0 confidence
    expect(result.reply).toBe("This is not JSON at all");
    expect(result.confidence).toBe(0);
  });

  it("throws on API error", async () => {
    mockComplete.mockRejectedValue(new Error("API unavailable"));

    const adapter = createAdapter();
    await expect(adapter.generateReply(basePrompt)).rejects.toThrow("API unavailable");
  });
});
