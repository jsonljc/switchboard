import { describe, it, expect, vi } from "vitest";
import { ContextBuilder } from "../context-builder.js";
import type { ContextBuilderConfig } from "../context-builder.js";

function makeConfig(overrides?: Partial<ContextBuilderConfig>): ContextBuilderConfig {
  return {
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
      valueProposition: "Best tests",
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
      get: vi.fn(),
      set: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    },
    actionRequestStore: {
      create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
      updateStatus: vi.fn(),
    },
    llmAdapter: {
      generateReply: vi.fn().mockResolvedValue({ reply: "ok", confidence: 0.9 }),
    },
    onChatExecute: vi.fn(),
    ...overrides,
  };
}

describe("ContextBuilder", () => {
  it("builds a valid AgentContext", () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const { ctx, notifications, handoffs } = builder.build();

    expect(ctx.persona.businessName).toBe("Test Co");
    expect(ctx.trust.score).toBe(80);
    expect(ctx.trust.level).toBe("autonomous");
    expect(ctx.state).toBeDefined();
    expect(ctx.chat).toBeDefined();
    expect(ctx.llm).toBeDefined();
    expect(ctx.notify).toBeTypeOf("function");
    expect(ctx.handoff).toBeTypeOf("function");
    expect(notifications).toEqual([]);
    expect(handoffs).toEqual([]);
  });

  it("includes conversation when provided", () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const { ctx } = builder.build({
      conversation: {
        id: "conv_1",
        messages: [{ role: "user", content: "hi" }],
      },
    });

    expect(ctx.conversation?.id).toBe("conv_1");
    expect(ctx.conversation?.messages).toHaveLength(1);
  });

  it("includes handoff payload when provided", () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const { ctx } = builder.build({
      handoffPayload: {
        fromAgent: "speed-to-lead",
        reason: "qualified",
        context: { budget: 5000 },
      },
    });

    expect(ctx.handoffPayload?.fromAgent).toBe("speed-to-lead");
  });

  it("accumulates notifications via ctx.notify", async () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const { ctx, notifications } = builder.build();

    await ctx.notify("Hello");
    await ctx.notify({ title: "Alert", body: "Something happened" });

    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toBe("Hello");
    expect(notifications[1]).toEqual({ title: "Alert", body: "Something happened" });
  });

  it("accumulates handoffs via ctx.handoff", async () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const { ctx, handoffs } = builder.build();

    await ctx.handoff("closer-agent", { reason: "qualified", context: { budget: 5000 } });

    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toEqual({
      to: "closer-agent",
      payload: { reason: "qualified", context: { budget: 5000 } },
    });
  });

  it("includes task when provided", () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const task = {
      id: "task_1",
      deploymentId: "dep_1",
      organizationId: "org_1",
      listingId: "listing_1",
      category: "follow_up",
      status: "pending" as const,
      input: { contactId: "c_1" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { ctx } = builder.build({ task });

    expect(ctx.task).toEqual(task);
  });
});
