import { describe, it, expect, vi } from "vitest";
import { AnthropicToolAdapter } from "../adapters/anthropic-tool-adapter.js";
import type { LLMResponse } from "../llm-types.js";

describe("AnthropicToolAdapter", () => {
  it("translates Anthropic response to provider-neutral LLMResponse", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };

    const adapter = new AnthropicToolAdapter(mockClient as never);
    const result: LLMResponse = await adapter.chatWithTools({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });

    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.content[0]!.type).toBe("text");
  });

  it("round-trips tool_use blocks through provider-neutral types", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            { type: "text", text: "Let me check that." },
            {
              type: "tool_use",
              id: "tu_abc123",
              name: "calendar.search",
              input: { date: "2026-05-20" },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 200, output_tokens: 75 },
        }),
      },
    };

    const adapter = new AnthropicToolAdapter(mockClient as never);
    const result = await adapter.chatWithTools({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Find me a slot" }],
      tools: [
        {
          name: "calendar.search",
          description: "Search calendar",
          input_schema: { type: "object", properties: { date: { type: "string" } } },
        },
      ],
    });

    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toHaveLength(2);
    expect(result.content[0]!.type).toBe("text");
    const toolUse = result.content[1]!;
    expect(toolUse.type).toBe("tool_use");
    if (toolUse.type === "tool_use") {
      expect(toolUse.id).toBe("tu_abc123");
      expect(toolUse.name).toBe("calendar.search");
      expect(toolUse.input).toEqual({ date: "2026-05-20" });
    }
  });

  it("throws LLMAdapterShapeMismatchError on unknown stop_reason", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "x" }],
          stop_reason: "refusal", // unknown — Anthropic may add new reasons
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };

    const adapter = new AnthropicToolAdapter(mockClient as never);
    await expect(
      adapter.chatWithTools({ system: "s", messages: [{ role: "user", content: "x" }], tools: [] }),
    ).rejects.toThrow(/unknown stop_reason: refusal/);
  });

  it("throws LLMAdapterShapeMismatchError on unknown content block type", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "server_thinking", text: "internal" }], // unknown
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };

    const adapter = new AnthropicToolAdapter(mockClient as never);
    await expect(
      adapter.chatWithTools({ system: "s", messages: [{ role: "user", content: "x" }], tools: [] }),
    ).rejects.toThrow(/unknown content_block: server_thinking/);
  });
});
