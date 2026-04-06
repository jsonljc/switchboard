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
    const ctx = builder.build();

    expect(ctx.persona.businessName).toBe("Test Co");
    expect(ctx.trust.score).toBe(80);
    expect(ctx.trust.level).toBe("autonomous");
    expect(ctx.state).toBeDefined();
    expect(ctx.chat).toBeDefined();
    expect(ctx.llm).toBeDefined();
    expect(ctx.notify).toBeTypeOf("function");
    expect(ctx.handoff).toBeTypeOf("function");
  });

  it("includes conversation when provided", () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const ctx = builder.build({
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
    const ctx = builder.build({
      handoffPayload: {
        fromAgent: "speed-to-lead",
        reason: "qualified",
        context: { budget: 5000 },
      },
    });

    expect(ctx.handoffPayload?.fromAgent).toBe("speed-to-lead");
  });
});
