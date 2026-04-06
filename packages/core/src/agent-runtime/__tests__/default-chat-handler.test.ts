import { describe, it, expect, vi } from "vitest";
import { DefaultChatHandler } from "../default-chat-handler.js";
import type { AgentContext } from "@switchboard/sdk";

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    state: { get: vi.fn(), set: vi.fn(), list: vi.fn(), delete: vi.fn() },
    chat: { send: vi.fn(), sendToThread: vi.fn() },
    files: {
      read: vi.fn(),
      write: vi.fn(),
    },
    browser: {
      navigate: vi.fn(),
      click: vi.fn(),
      extract: vi.fn(),
      screenshot: vi.fn(),
    },
    llm: {
      chat: vi.fn().mockResolvedValue({ text: "Hello! How can I help you today?" }),
    },
    notify: vi.fn(),
    handoff: vi.fn(),
    persona: {
      id: "p_1",
      organizationId: "org_1",
      businessName: "Bloom Flowers",
      businessType: "small_business",
      productService: "Wedding flowers",
      valueProposition: "Beautiful arrangements",
      tone: "professional",
      qualificationCriteria: {},
      disqualificationCriteria: {},
      bookingLink: null,
      escalationRules: {},
      customInstructions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    conversation: {
      id: "conv_1",
      messages: [{ role: "user", content: "I need flowers for my wedding" }],
    },
    trust: { score: 80, level: "autonomous" },
    ...overrides,
  } as AgentContext;
}

describe("DefaultChatHandler", () => {
  it("calls llm.chat with system prompt and filtered messages", async () => {
    const ctx = makeContext();
    await DefaultChatHandler.onMessage!(ctx);

    expect(ctx.llm.chat).toHaveBeenCalledTimes(1);
    const callArgs = (ctx.llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.system).toContain("Bloom Flowers");
    expect(callArgs.messages).toEqual([{ role: "user", content: "I need flowers for my wedding" }]);
  });

  it("sends the LLM response via chat.send", async () => {
    const ctx = makeContext();
    await DefaultChatHandler.onMessage!(ctx);

    expect(ctx.chat.send).toHaveBeenCalledWith("Hello! How can I help you today?");
  });

  it("filters out non-user/assistant messages", async () => {
    const ctx = makeContext({
      conversation: {
        id: "conv_1",
        messages: [
          { role: "system", content: "ignored" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi there" },
          { role: "tool", content: "also ignored" },
          { role: "user", content: "how are you?" },
        ],
      },
    });
    await DefaultChatHandler.onMessage!(ctx);

    const callArgs = (ctx.llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "how are you?" },
    ]);
  });

  it("handles missing conversation gracefully", async () => {
    const ctx = makeContext({ conversation: undefined });
    await DefaultChatHandler.onMessage!(ctx);

    const callArgs = (ctx.llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.messages).toEqual([]);
  });
});
