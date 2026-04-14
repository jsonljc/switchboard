import { describe, it, expect, vi } from "vitest";
import { SkillHandler } from "./skill-handler.js";
import type { SkillDefinition } from "./types.js";

const mockSkill: SkillDefinition = {
  name: "test",
  slug: "test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [
    { name: "BUSINESS_NAME", type: "string", required: true },
    { name: "PIPELINE_STAGE", type: "enum", required: true, values: ["interested", "qualified"] },
    { name: "OPPORTUNITY_ID", type: "string", required: true },
    {
      name: "PERSONA_CONFIG",
      type: "object",
      required: true,
      schema: { tone: { type: "string" } },
    },
  ],
  tools: [],
  body: "test",
};

function createMockCtx() {
  return {
    persona: {
      businessName: "TestBiz",
      tone: "friendly",
      qualificationCriteria: {},
      disqualificationCriteria: {},
      escalationRules: {},
      bookingLink: null,
      customInstructions: null,
    },
    conversation: {
      id: "conv1",
      messages: [{ role: "user", content: "hi" }],
    },
    trust: { score: 50, level: "guided" as const },
    chat: { send: vi.fn(), sendToThread: vi.fn() },
    state: { get: vi.fn(), set: vi.fn(), list: vi.fn(), delete: vi.fn() },
    files: { read: vi.fn(), write: vi.fn() },
    browser: { navigate: vi.fn(), click: vi.fn(), extract: vi.fn(), screenshot: vi.fn() },
    llm: { chat: vi.fn() },
    notify: vi.fn(),
    handoff: vi.fn(),
  } as unknown as import("@switchboard/sdk").AgentContext;
}

describe("SkillHandler", () => {
  it("escalates when no active opportunity found", async () => {
    const mockOpportunityStore = {
      findActiveByContact: vi.fn().mockResolvedValue([]),
    };
    const mockContactStore = { findById: vi.fn().mockResolvedValue(null) };
    const mockExecutor = { execute: vi.fn() };

    const handler = new SkillHandler(
      mockSkill,
      mockExecutor as unknown as import("./skill-executor.js").SkillExecutorImpl,
      { opportunityStore: mockOpportunityStore, contactStore: mockContactStore },
      { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    );

    const ctx = createMockCtx();
    await handler.onMessage(ctx);

    expect(ctx.chat.send).toHaveBeenCalledWith(expect.stringContaining("no active deal"));
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it("resolves opportunity and calls executor", async () => {
    const mockOpportunityStore = {
      findActiveByContact: vi
        .fn()
        .mockResolvedValue([{ id: "opp1", stage: "interested", createdAt: new Date() }]),
    };
    const mockContactStore = {
      findById: vi.fn().mockResolvedValue({ id: "c1", name: "Alice" }),
    };
    const mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        response: "Hello!",
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
      }),
    };

    const handler = new SkillHandler(
      mockSkill,
      mockExecutor as unknown as import("./skill-executor.js").SkillExecutorImpl,
      { opportunityStore: mockOpportunityStore, contactStore: mockContactStore },
      { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    );

    const ctx = createMockCtx();
    await handler.onMessage(ctx);

    expect(mockExecutor.execute).toHaveBeenCalledOnce();
    const executorArgs = mockExecutor.execute.mock.calls[0]![0] as Record<string, unknown>;
    const params = executorArgs["parameters"] as Record<string, unknown>;
    expect(params["BUSINESS_NAME"]).toBe("TestBiz");
    expect(params["PIPELINE_STAGE"]).toBe("interested");
    expect(params["OPPORTUNITY_ID"]).toBe("opp1");
    expect(ctx.chat.send).toHaveBeenCalledWith("Hello!");
  });

  it("takes most recent opportunity when multiple exist", async () => {
    const older = { id: "opp1", stage: "interested", createdAt: new Date("2025-01-01") };
    const newer = { id: "opp2", stage: "qualified", createdAt: new Date("2026-01-01") };
    const mockOpportunityStore = {
      findActiveByContact: vi.fn().mockResolvedValue([older, newer]),
    };
    const mockContactStore = {
      findById: vi.fn().mockResolvedValue({ id: "c1", name: "Bob" }),
    };
    const mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        response: "Hi",
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
      }),
    };

    const handler = new SkillHandler(
      mockSkill,
      mockExecutor as unknown as import("./skill-executor.js").SkillExecutorImpl,
      { opportunityStore: mockOpportunityStore, contactStore: mockContactStore },
      { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    );

    const ctx = createMockCtx();
    await handler.onMessage(ctx);

    const executorArgs = mockExecutor.execute.mock.calls[0]![0] as Record<string, unknown>;
    const params = executorArgs["parameters"] as Record<string, unknown>;
    expect(params["OPPORTUNITY_ID"]).toBe("opp2");
    expect(params["PIPELINE_STAGE"]).toBe("qualified");
  });
});
