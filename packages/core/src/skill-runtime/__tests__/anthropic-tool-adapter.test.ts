import { describe, it, expect, vi } from "vitest";
import {
  AnthropicToolAdapter,
  encodeToolName,
  decodeToolName,
} from "../adapters/anthropic-tool-adapter.js";
import type { LLMResponse } from "../llm-types.js";

// ---------------------------------------------------------------------------
// encodeToolName / decodeToolName — pure unit tests, no network
// ---------------------------------------------------------------------------

describe("encodeToolName", () => {
  it('replaces every "." with "__"', () => {
    expect(encodeToolName("crm-query.contact.get")).toBe("crm-query__contact__get");
    expect(encodeToolName("calendar-book.booking.create")).toBe("calendar-book__booking__create");
  });

  it("is a no-op on names that have no dots", () => {
    expect(encodeToolName("escalate")).toBe("escalate");
    expect(encodeToolName("crm-query")).toBe("crm-query");
  });

  it("preserves single-underscore names unchanged", () => {
    expect(encodeToolName("my_tool")).toBe("my_tool");
    expect(encodeToolName("tool_name-kebab")).toBe("tool_name-kebab");
  });

  it("throws when the source name already contains '__'", () => {
    expect(() => encodeToolName("bad__name")).toThrow(/already contains "__"/);
    expect(() => encodeToolName("crm-query__contact")).toThrow(/already contains "__"/);
  });

  describe("encodeToolName encoded-output validation", () => {
    it("throws when the encoded name violates Anthropic's tool-name pattern", () => {
      // A space survives "."→"__" encoding and breaks ^[a-zA-Z0-9_-]{1,128}$
      expect(() => encodeToolName("bad name.op")).toThrow(/violates Anthropic/);
    });

    it("throws when the encoded name exceeds 128 characters", () => {
      // 129 alphanumeric chars: passes the "__" guard but fails ^...{1,128}$
      expect(() => encodeToolName("a".repeat(129))).toThrow(/violates Anthropic/);
    });
  });
});

describe("decodeToolName", () => {
  it('replaces every "__" with "."', () => {
    expect(decodeToolName("crm-query__contact__get")).toBe("crm-query.contact.get");
    expect(decodeToolName("calendar-book__booking__create")).toBe("calendar-book.booking.create");
  });

  it("is a no-op on names with no double-underscore", () => {
    expect(decodeToolName("escalate")).toBe("escalate");
    expect(decodeToolName("my_tool")).toBe("my_tool");
  });
});

describe("encodeToolName / decodeToolName round-trip", () => {
  const cases = ["crm-query.contact.get", "calendar-book.booking.create", "escalate", "tool-id.op"];

  for (const name of cases) {
    it(`round-trips "${name}"`, () => {
      expect(decodeToolName(encodeToolName(name))).toBe(name);
    });
  }
});

// ---------------------------------------------------------------------------
// AnthropicToolAdapter — integration tests using a fake Anthropic client
// ---------------------------------------------------------------------------

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

  it("encodes dotted tool names on the outgoing API call", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const mockClient = { messages: { create: mockCreate } };

    const adapter = new AnthropicToolAdapter(mockClient as never);
    await adapter.chatWithTools({
      system: "s",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          name: "crm-query.contact.get",
          description: "Get a contact",
          input_schema: { type: "object", properties: {} },
        },
        {
          name: "calendar-book.booking.create",
          description: "Book a slot",
          input_schema: { type: "object", properties: {} },
        },
      ],
    });

    const calledWith = mockCreate.mock.calls[0]![0] as { tools: { name: string }[] };
    const wireNames = calledWith.tools.map((t: { name: string }) => t.name);

    // All wire names must satisfy the Anthropic API pattern
    const apiPattern = /^[a-zA-Z0-9_-]+$/;
    for (const wireName of wireNames) {
      expect(wireName).toMatch(apiPattern);
      expect(wireName).not.toContain(".");
    }

    expect(wireNames).toContain("crm-query__contact__get");
    expect(wireNames).toContain("calendar-book__booking__create");
  });

  it("decodes tool_use block names in the response back to dotted form", async () => {
    // Simulate Anthropic returning an encoded name on the wire
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            { type: "text", text: "Let me check." },
            {
              type: "tool_use",
              id: "tu_abc123",
              name: "crm-query__contact__get", // wire format — encoded
              input: { contactId: "c_1" },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 200, output_tokens: 75 },
        }),
      },
    };

    const adapter = new AnthropicToolAdapter(mockClient as never);
    const result = await adapter.chatWithTools({
      system: "s",
      messages: [{ role: "user", content: "Look up contact" }],
      tools: [
        {
          name: "crm-query.contact.get",
          description: "Get a contact",
          input_schema: { type: "object", properties: { contactId: { type: "string" } } },
        },
      ],
    });

    const toolUse = result.content[1]!;
    expect(toolUse.type).toBe("tool_use");
    if (toolUse.type === "tool_use") {
      expect(toolUse.name).toBe("crm-query.contact.get"); // decoded back to dotted form
      expect(toolUse.id).toBe("tu_abc123");
      expect(toolUse.input).toEqual({ contactId: "c_1" });
    }
  });

  it("round-trips tool_use blocks through provider-neutral types (dotted names preserved end-to-end)", async () => {
    // Wire: adapter encodes on the way out; fake client returns encoded name; adapter decodes back.
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            { type: "text", text: "Let me check that." },
            {
              type: "tool_use",
              id: "tu_abc123",
              // The Anthropic API returns the encoded name (as the model was told that name)
              name: "calendar__search",
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
      expect(toolUse.name).toBe("calendar.search"); // decoded from wire "calendar__search"
      expect(toolUse.input).toEqual({ date: "2026-05-20" });
    }
  });

  it("re-encodes dotted tool_use names in OUTGOING message history (multi-turn fix)", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "all set" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const adapter = new AnthropicToolAdapter({ messages: { create: mockCreate } } as never);

    await adapter.chatWithTools({
      system: "s",
      messages: [
        { role: "user", content: "Book me in" },
        // Turn-1 assistant tool_use, exactly as the executor stores it: DECODED (dotted).
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "calendar-book.booking.create",
              input: { slot: "x" },
            },
          ],
        },
        // Turn-1 tool_result — carries tool_use_id (no name) and must pass through.
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }] },
      ],
      tools: [
        {
          name: "calendar-book.booking.create",
          description: "Book",
          input_schema: { type: "object", properties: {} },
        },
      ],
    });

    const sent = mockCreate.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const assistantBlocks = sent.messages[1]!.content as Array<{ type: string; name?: string }>;
    expect(assistantBlocks[0]!.name).toBe("calendar-book__booking__create");
    expect(assistantBlocks[0]!.name).not.toContain(".");

    const resultBlocks = sent.messages[2]!.content as Array<{ type: string; tool_use_id?: string }>;
    expect(resultBlocks[0]!.type).toBe("tool_result");
    expect(resultBlocks[0]!.tool_use_id).toBe("tu_1");
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
