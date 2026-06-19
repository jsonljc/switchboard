import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAnthropicAdapter } from "../anthropic-adapter.js";
import type { ConversationPrompt } from "../../llm-adapter.js";
import { createInMemoryMetrics, setMetrics } from "../../telemetry/metrics.js";

const createMock = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Hello! How can I help you?" }],
  // usage included so the adapter's per-call cache-effectiveness recording reads
  // cleanly and emits a non-miss outcome (no zero-read warn) in these fixtures.
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 20,
  },
});

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: createMock },
  })),
}));

function makePrompt(overrides?: Partial<ConversationPrompt>): ConversationPrompt {
  return {
    systemPrompt: "You are a helpful assistant.",
    conversationHistory: [
      {
        id: "m_1",
        contactId: "c_1",
        direction: "inbound",
        content: "Hello",
        timestamp: new Date().toISOString(),
        channel: "dashboard",
      },
    ],
    retrievedContext: [],
    agentInstructions: "",
    ...overrides,
  };
}

describe("createAnthropicAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an adapter that implements generateReply", () => {
    const adapter = createAnthropicAdapter("test-key");
    expect(adapter.generateReply).toBeTypeOf("function");
  });

  it("translates ConversationPrompt to Anthropic API call", async () => {
    const adapter = createAnthropicAdapter("test-key");
    const prompt = makePrompt();
    const result = await adapter.generateReply(prompt);

    expect(result.reply).toBe("Hello! How can I help you?");
    expect(result.confidence).toBe(0.9);
  });

  it("maps inbound messages to user role and outbound to assistant", async () => {
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(
      makePrompt({
        conversationHistory: [
          {
            id: "m_1",
            contactId: "c_1",
            direction: "inbound",
            content: "Hi",
            timestamp: new Date().toISOString(),
            channel: "dashboard",
          },
          {
            id: "m_2",
            contactId: "c_1",
            direction: "outbound",
            content: "Hello!",
            timestamp: new Date().toISOString(),
            channel: "dashboard",
          },
        ],
      }),
    );

    const callArgs = createMock.mock.calls[0]![0];
    expect(callArgs.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ]);
  });

  it("includes system prompt with agent instructions and retrieved context", async () => {
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(
      makePrompt({
        systemPrompt: "You are Bloom's assistant.",
        agentInstructions: "Be concise.",
        retrievedContext: [{ content: "We sell roses.", sourceType: "document", similarity: 0.95 }],
      }),
    );

    const callArgs = createMock.mock.calls[0]![0];
    // system is now a content-block array; join block text to assert all three pieces are present.
    const joined = callArgs.system.map((b: { text: string }) => b.text).join("\n\n");
    expect(joined).toContain("You are Bloom's assistant.");
    expect(joined).toContain("Be concise.");
    expect(joined).toContain("We sell roses.");
  });

  it("uses modelConfig when provided", async () => {
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(makePrompt(), {
      slot: "premium",
      modelId: "claude-opus-4-6",
      maxTokens: 2048,
      temperature: 0.5,
      timeoutMs: 10000,
    });

    const callArgs = createMock.mock.calls[0]![0];
    expect(callArgs.model).toBe("claude-opus-4-6");
    expect(callArgs.max_tokens).toBe(2048);
    expect(callArgs.temperature).toBe(0.5);
  });

  it("omits temperature for a 4.7+ model id (forward-compat; avoids the hard-400)", async () => {
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(makePrompt(), {
      slot: "critical",
      modelId: "claude-opus-4-8",
      maxTokens: 2048,
      temperature: 0.5,
      timeoutMs: 10000,
    });

    const callArgs = createMock.mock.calls[0]![0];
    expect("temperature" in callArgs).toBe(false);
  });

  it("records per-call prompt-cache effectiveness from the response usage", async () => {
    const metrics = createInMemoryMetrics();
    setMetrics(metrics);
    const inc = vi.spyOn(metrics.llmCacheCallsTotal, "inc");
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(makePrompt(), {
      slot: "premium",
      modelId: "claude-opus-4-6",
      maxTokens: 2048,
      temperature: 0.5,
      timeoutMs: 10000,
    });

    // mock usage has cache_read 0, cache_creation 20 -> "populate"
    expect(inc).toHaveBeenCalledWith({ model: "claude-opus-4-6", outcome: "populate" });
  });
});

describe("createAnthropicAdapter prompt caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends system as a block array: base cached, RAG + instructions uncached, order preserved", async () => {
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(
      makePrompt({
        systemPrompt: "BASE PROMPT",
        retrievedContext: [{ content: "We sell roses.", sourceType: "document", similarity: 0.95 }],
        agentInstructions: "Be concise.",
      }),
    );

    const callArgs = createMock.mock.calls[0]![0];

    // system is an array
    expect(Array.isArray(callArgs.system)).toBe(true);

    // block 0 is the base prompt and carries the cache breakpoint
    expect(callArgs.system[0]).toMatchObject({
      type: "text",
      text: "BASE PROMPT",
      cache_control: { type: "ephemeral" },
    });

    // RAG block: starts with "Relevant context:\n" and is explicitly NOT cached
    const ragBlock = callArgs.system[1];
    expect(ragBlock.text.startsWith("Relevant context:\n")).toBe(true);
    expect(ragBlock.text).toContain("We sell roses.");
    expect(ragBlock.cache_control).toBeUndefined();

    // agent-instructions block: explicitly NOT cached
    const instructionsBlock = callArgs.system[2];
    expect(instructionsBlock.text).toBe("Be concise.");
    expect(instructionsBlock.cache_control).toBeUndefined();
  });

  it("caches the base prompt block when there is no RAG or agent instructions", async () => {
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(
      makePrompt({ systemPrompt: "BASE ONLY", retrievedContext: [], agentInstructions: "" }),
    );

    const callArgs = createMock.mock.calls[0]![0];
    expect(Array.isArray(callArgs.system)).toBe(true);
    expect(callArgs.system).toHaveLength(1);
    expect(callArgs.system[0]).toMatchObject({
      type: "text",
      text: "BASE ONLY",
      cache_control: { type: "ephemeral" },
    });
  });

  it("falls back to claude-sonnet-4-6 when no modelConfig is provided", async () => {
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(makePrompt());

    const callArgs = createMock.mock.calls[0]![0];
    expect(callArgs.model).toBe("claude-sonnet-4-6");
  });
});
