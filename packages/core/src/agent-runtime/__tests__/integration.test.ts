import { describe, it, expect, vi } from "vitest";
import { AgentRuntime } from "../agent-runtime.js";
import type { AgentHandler, AgentContext } from "@switchboard/sdk";

describe("AgentRuntime integration", () => {
  it("full message flow: handler receives context, sends response, governed by trust", async () => {
    const sentMessages: string[] = [];

    const handler: AgentHandler = {
      async onMessage(ctx: AgentContext) {
        const lastMsg = ctx.conversation?.messages.at(-1);
        const name = ctx.persona.businessName;
        await ctx.chat.send(`Welcome to ${name}! You said: ${lastMsg?.content}`);
      },
    };

    const runtime = new AgentRuntime({
      handler,
      deploymentId: "dep_1",
      surface: "test_chat",
      trustScore: 80,
      trustLevel: "autonomous",
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
      stateStore: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
      },
      actionRequestStore: {
        create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
        updateStatus: vi.fn(),
      },
      llmAdapter: {
        generateReply: vi.fn().mockResolvedValue({ reply: "ok", confidence: 0.9 }),
      },
      onChatExecute: (msg) => {
        sentMessages.push(msg);
      },
    });

    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "I need flowers" }],
    });

    expect(sentMessages).toEqual(["Welcome to Bloom Flowers! You said: I need flowers"]);
  });

  it("supervised agent queues message instead of sending", async () => {
    const sentMessages: string[] = [];
    const createdRequests: unknown[] = [];

    const handler: AgentHandler = {
      async onMessage(ctx: AgentContext) {
        await ctx.chat.send("Response that needs approval");
      },
    };

    const runtime = new AgentRuntime({
      handler,
      deploymentId: "dep_1",
      surface: "telegram",
      trustScore: 10,
      trustLevel: "supervised",
      persona: {
        id: "p_1",
        organizationId: "org_1",
        businessName: "Test",
        businessType: "small_business",
        productService: "Test",
        valueProposition: "Test",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        bookingLink: null,
        escalationRules: {},
        customInstructions: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      stateStore: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
      },
      actionRequestStore: {
        create: vi.fn().mockImplementation((input) => {
          createdRequests.push(input);
          return Promise.resolve({ id: "ar_1", status: "pending" });
        }),
        updateStatus: vi.fn(),
      },
      llmAdapter: {
        generateReply: vi.fn().mockResolvedValue({ reply: "ok", confidence: 0.9 }),
      },
      onChatExecute: (msg) => {
        sentMessages.push(msg);
      },
    });

    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "hello" }],
    });

    // Message NOT sent — queued for approval
    expect(sentMessages).toHaveLength(0);
    // Action request created
    expect(createdRequests).toHaveLength(1);
    expect(createdRequests[0]).toMatchObject({
      type: "send_message",
      surface: "telegram",
      payload: { content: "Response that needs approval" },
    });
  });

  it("stateful agent persists across handler calls", async () => {
    const stateData = new Map<string, unknown>();

    const handler: AgentHandler = {
      async onMessage(ctx: AgentContext) {
        const count = (await ctx.state.get<number>("msg_count")) ?? 0;
        await ctx.state.set("msg_count", count + 1);
        await ctx.chat.send(`Message #${count + 1}`);
      },
    };

    const stateStore = {
      get: vi
        .fn()
        .mockImplementation((_depId: string, key: string) =>
          Promise.resolve(stateData.get(key) ?? null),
        ),
      set: vi.fn().mockImplementation((_depId: string, key: string, value: unknown) => {
        stateData.set(key, value);
        return Promise.resolve();
      }),
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    };

    const sentMessages: string[] = [];

    const runtime = new AgentRuntime({
      handler,
      deploymentId: "dep_1",
      surface: "test_chat",
      trustScore: 80,
      trustLevel: "autonomous",
      persona: {
        id: "p_1",
        organizationId: "org_1",
        businessName: "Test",
        businessType: "small_business",
        productService: "Test",
        valueProposition: "Test",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        bookingLink: null,
        escalationRules: {},
        customInstructions: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      stateStore,
      actionRequestStore: {
        create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
        updateStatus: vi.fn(),
      },
      llmAdapter: {
        generateReply: vi.fn().mockResolvedValue({ reply: "ok", confidence: 0.9 }),
      },
      onChatExecute: (msg) => {
        sentMessages.push(msg);
      },
    });

    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "first" }],
    });
    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "second" }],
    });

    expect(sentMessages).toEqual(["Message #1", "Message #2"]);
  });
});
