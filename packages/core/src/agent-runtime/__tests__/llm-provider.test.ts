import { describe, it, expect, vi } from "vitest";
import { RuntimeLLMProvider } from "../llm-provider.js";
import type { LLMAdapter } from "../../llm-adapter.js";

describe("RuntimeLLMProvider", () => {
  it("translates SDK chat() call to LLMAdapter generateReply()", async () => {
    const mockAdapter: LLMAdapter = {
      generateReply: vi.fn().mockResolvedValue({
        reply: "I can help with that!",
        confidence: 0.95,
      }),
    };

    const provider = new RuntimeLLMProvider(mockAdapter);

    const result = await provider.chat({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.text).toBe("I can help with that!");
    expect(mockAdapter.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "You are a helpful assistant.",
        conversationHistory: [
          expect.objectContaining({
            direction: "inbound",
            content: "Hello",
            channel: "dashboard",
          }),
        ],
      }),
      undefined,
    );
  });

  it("translates multiple messages with user and assistant roles", async () => {
    const mockAdapter: LLMAdapter = {
      generateReply: vi.fn().mockResolvedValue({
        reply: "Sure!",
        confidence: 0.9,
      }),
    };

    const provider = new RuntimeLLMProvider(mockAdapter);

    await provider.chat({
      system: "You are a bot.",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "Can you help?" },
      ],
    });

    expect(mockAdapter.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationHistory: [
          expect.objectContaining({ direction: "inbound", content: "Hi" }),
          expect.objectContaining({ direction: "outbound", content: "Hello!" }),
          expect.objectContaining({ direction: "inbound", content: "Can you help?" }),
        ],
      }),
      undefined,
    );
  });

  it("passes ModelConfig through to LLMAdapter", async () => {
    const mockAdapter: LLMAdapter = {
      generateReply: vi.fn().mockResolvedValue({
        reply: "Yes",
        confidence: 0.8,
      }),
    };

    const modelConfig = {
      slot: "premium" as const,
      modelId: "claude-sonnet-4-6",
      maxTokens: 2048,
      temperature: 0.5,
      timeoutMs: 8000,
    };

    const provider = new RuntimeLLMProvider(mockAdapter, modelConfig);

    await provider.chat({
      system: "System",
      messages: [{ role: "user", content: "Test" }],
    });

    expect(mockAdapter.generateReply).toHaveBeenCalledWith(expect.anything(), modelConfig);
  });
});
