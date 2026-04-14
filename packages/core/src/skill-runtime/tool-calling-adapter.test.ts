import { describe, it, expect, vi } from "vitest";
import { AnthropicToolCallingAdapter } from "./tool-calling-adapter.js";

describe("AnthropicToolCallingAdapter", () => {
  it("calls Anthropic messages.create with tools parameter", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const adapter = new AnthropicToolCallingAdapter({
      messages: { create: mockCreate },
    } as unknown as import("@anthropic-ai/sdk").default);

    const result = await adapter.chatWithTools({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.stopReason).toBe("end_turn");
    expect(result.content).toHaveLength(1);
    expect(result.usage.inputTokens).toBe(100);
  });

  it("passes tools to API call", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "crm-query.contact.get",
          input: { contactId: "c1" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const adapter = new AnthropicToolCallingAdapter({
      messages: { create: mockCreate },
    } as unknown as import("@anthropic-ai/sdk").default);

    const tools = [
      {
        name: "crm-query.contact.get",
        description: "Get contact",
        input_schema: {
          type: "object" as const,
          properties: { contactId: { type: "string" } },
        },
      },
    ];

    const result = await adapter.chatWithTools({
      system: "test",
      messages: [{ role: "user", content: "get contact" }],
      tools,
    });

    const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect((callArgs["tools"] as unknown[]).length).toBe(1);
    expect(result.stopReason).toBe("tool_use");
  });
});
