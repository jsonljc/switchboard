import { describe, it, expect } from "vitest";
import type { LLMAdapter, ConversationPrompt, LLMReply } from "../llm-adapter.js";

describe("LLMAdapter interface", () => {
  it("can be implemented with a mock adapter", async () => {
    const adapter: LLMAdapter = {
      async generateReply(prompt: ConversationPrompt): Promise<LLMReply> {
        return {
          reply: `Response to: ${prompt.agentInstructions}`,
          confidence: 0.85,
        };
      },
    };

    const result = await adapter.generateReply({
      systemPrompt: "You are a friendly receptionist.",
      conversationHistory: [],
      retrievedContext: [],
      agentInstructions: "Greet the customer",
    });

    expect(result.reply).toBe("Response to: Greet the customer");
    expect(result.confidence).toBe(0.85);
  });

  it("confidence ranges from 0 to 1", async () => {
    const adapter: LLMAdapter = {
      async generateReply(): Promise<LLMReply> {
        return { reply: "test", confidence: 0.0 };
      },
    };

    const result = await adapter.generateReply({
      systemPrompt: "",
      conversationHistory: [],
      retrievedContext: [],
      agentInstructions: "",
    });

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
