import { describe, it, expect, vi } from "vitest";
import { AgentRuntime } from "../agent-runtime.js";
import type { AgentHandler } from "@switchboard/sdk";
import type { AgentRuntimeConfig } from "../agent-runtime.js";

function makeRuntimeConfig(
  handler: AgentHandler,
  overrides?: Partial<AgentRuntimeConfig>,
): AgentRuntimeConfig {
  return {
    handler,
    deploymentId: "dep_1",
    surface: "test_chat",
    trustScore: 80,
    trustLevel: "autonomous",
    persona: {
      id: "p_1",
      organizationId: "org_1",
      businessName: "Test Co",
      businessType: "small_business",
      productService: "Testing",
      valueProposition: "Best",
      tone: "professional",
      qualificationCriteria: {},
      disqualificationCriteria: {},
      bookingLink: null,
      escalationRules: {},
      customInstructions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    stateStore: { get: vi.fn(), set: vi.fn(), list: vi.fn(), delete: vi.fn() },
    actionRequestStore: {
      create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
      updateStatus: vi.fn(),
    },
    llmAdapter: {
      generateReply: vi.fn().mockResolvedValue({ reply: "Hello!", confidence: 0.9 }),
    },
    onChatExecute: vi.fn(),
    ...overrides,
  };
}

describe("AgentRuntime", () => {
  it("dispatches onMessage event", async () => {
    const onMessage = vi.fn();
    const handler: AgentHandler = { onMessage };
    const runtime = new AgentRuntime(makeRuntimeConfig(handler));

    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    const ctx = onMessage.mock.calls[0]?.[0];
    expect(ctx).toBeDefined();
    expect(ctx?.persona.businessName).toBe("Test Co");
    expect(ctx?.conversation).toBeDefined();
    expect(ctx?.conversation?.messages).toHaveLength(1);
  });

  it("dispatches onHandoff event", async () => {
    const onHandoff = vi.fn();
    const handler: AgentHandler = { onHandoff };
    const runtime = new AgentRuntime(makeRuntimeConfig(handler));

    await runtime.handleHandoff({
      fromAgent: "speed-to-lead",
      reason: "qualified",
      context: { budget: 5000 },
    });

    expect(onHandoff).toHaveBeenCalledTimes(1);
    const ctx = onHandoff.mock.calls[0]?.[0];
    expect(ctx).toBeDefined();
    expect(ctx?.handoffPayload).toBeDefined();
    expect(ctx?.handoffPayload?.fromAgent).toBe("speed-to-lead");
  });

  it("dispatches onSchedule event", async () => {
    const onSchedule = vi.fn();
    const handler: AgentHandler = { onSchedule };
    const runtime = new AgentRuntime(makeRuntimeConfig(handler));

    await runtime.handleSchedule();

    expect(onSchedule).toHaveBeenCalledTimes(1);
  });

  it("throws if handler method is not defined for event", async () => {
    const handler: AgentHandler = {};
    const runtime = new AgentRuntime(makeRuntimeConfig(handler));

    await expect(
      runtime.handleMessage({
        conversationId: "conv_1",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("does not implement onMessage");
  });
});
