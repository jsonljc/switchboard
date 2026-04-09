import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAnthropicAdapter } from "../anthropic-adapter.js";
import type { ConversationPrompt } from "../../llm-adapter.js";

const createMock = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Hello! How can I help you?" }],
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
    expect(callArgs.system).toContain("You are Bloom's assistant.");
    expect(callArgs.system).toContain("Be concise.");
    expect(callArgs.system).toContain("We sell roses.");
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
});
