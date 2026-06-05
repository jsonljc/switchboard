import { describe, it, expect, vi } from "vitest";
import { AnthropicToolCallingAdapter } from "../tool-calling-adapter.js";
import type { ResolvedModelProfile } from "../types.js";

describe("AnthropicToolCallingAdapter", () => {
  it("uses default model when no profile provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const client = { messages: { create: mockCreate } } as any;

    const adapter = new AnthropicToolCallingAdapter(client);
    await adapter.chatWithTools({
      system: "You are helpful",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });

    // Body is the first arg; a second per-request options arg (signal/timeout/
    // maxRetries) is now also passed — assert on the body explicitly.
    const body = mockCreate.mock.calls[0]![0] as { model: string; max_tokens: number };
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(1024);
  });

  it("uses profile model when provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const client = { messages: { create: mockCreate } } as any;

    const profile: ResolvedModelProfile = {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 2048,
      temperature: 0.7,
      timeoutMs: 30000,
    };

    const adapter = new AnthropicToolCallingAdapter(client);
    await adapter.chatWithTools({
      system: "You are helpful",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      profile,
    });

    const body = mockCreate.mock.calls[0]![0] as { model: string };
    expect(body.model).toBe("claude-haiku-4-5-20251001");
  });

  it("uses profile maxTokens over default", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const client = { messages: { create: mockCreate } } as any;

    const profile: ResolvedModelProfile = {
      model: "claude-sonnet-4-5-20250514",
      maxTokens: 4096,
      temperature: 1.0,
      timeoutMs: 60000,
    };

    const adapter = new AnthropicToolCallingAdapter(client);
    await adapter.chatWithTools({
      system: "You are helpful",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      profile,
    });

    const body = mockCreate.mock.calls[0]![0] as { max_tokens: number };
    expect(body.max_tokens).toBe(4096);
  });
});
