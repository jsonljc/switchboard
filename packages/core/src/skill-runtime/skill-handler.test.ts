import { describe, it, expect, vi } from "vitest";
import { SkillHandler } from "./skill-handler.js";
import { ParameterResolutionError } from "./parameter-builder.js";
import type { SkillDefinition } from "./types.js";
import type { ParameterBuilder, SkillStores } from "./parameter-builder.js";

const mockSkill: SkillDefinition = {
  name: "test",
  slug: "test-skill",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [{ name: "NAME", type: "string", required: true }],
  tools: [],
  body: "Hello {{NAME}}",
  context: [],
};

const mockStores: SkillStores = {
  opportunityStore: { findActiveByContact: vi.fn() },
  contactStore: { findById: vi.fn() },
  activityStore: { listByDeployment: vi.fn() },
};

function makeCtx() {
  return {
    sessionId: "session-1",
    persona: { businessName: "Biz" },
    conversation: { id: "conv-1", messages: [{ role: "user", content: "hi" }] },
    trust: { score: 50, level: "guided" as const },
    chat: { send: vi.fn() },
  } as any;
}

function makeTraceStore() {
  return {
    create: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeCircuitBreaker(allowed = true) {
  return {
    check: vi.fn().mockResolvedValue({ allowed, reason: allowed ? undefined : "tripped" }),
  } as any;
}

function makeBlastRadius(allowed = true) {
  return {
    check: vi.fn().mockResolvedValue({ allowed, reason: allowed ? undefined : "capped" }),
  } as any;
}

function makeOutcomeLinker() {
  return { linkFromToolCalls: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeContextResolver() {
  return { resolve: vi.fn().mockResolvedValue({ variables: {}, metadata: [] }) } as any;
}

function makeExecutorResult(overrides: Record<string, unknown> = {}) {
  return {
    response: "Hello Alice",
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 150,
      turnCount: 1,
      status: "success",
      responseSummary: "Hello Alice",
      writeCount: 0,
      governanceDecisions: [],
    },
    ...overrides,
  };
}

describe("SkillHandler (generic)", () => {
  it("throws when no builder registered for slug", async () => {
    const handler = new SkillHandler(
      mockSkill,
      { execute: vi.fn() } as any,
      new Map(),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      makeTraceStore(),
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      makeContextResolver(),
    );
    await expect(handler.onMessage!(makeCtx())).rejects.toThrow("No parameter builder registered");
  });

  it("calls builder and executor, sends response", async () => {
    const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
    const executor = { execute: vi.fn().mockResolvedValue(makeExecutorResult()) };
    const builderMap = new Map([["test-skill", builder]]);
    const handler = new SkillHandler(
      mockSkill,
      executor as any,
      builderMap,
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      makeTraceStore(),
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      makeContextResolver(),
    );

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(builder).toHaveBeenCalledWith(
      ctx,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      mockStores,
    );
    expect(executor.execute).toHaveBeenCalledOnce();
    expect(ctx.chat.send).toHaveBeenCalledWith("Hello Alice");
  });

  it("catches ParameterResolutionError and sends userMessage", async () => {
    const builder: ParameterBuilder = vi
      .fn()
      .mockRejectedValue(new ParameterResolutionError("no-opp", "No active deal found."));
    const executor = { execute: vi.fn() };
    const builderMap = new Map([["test-skill", builder]]);
    const handler = new SkillHandler(
      mockSkill,
      executor as any,
      builderMap,
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      makeTraceStore(),
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      makeContextResolver(),
    );

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(ctx.chat.send).toHaveBeenCalledWith("No active deal found.");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("re-throws non-ParameterResolutionError errors", async () => {
    const builder: ParameterBuilder = vi.fn().mockRejectedValue(new Error("DB down"));
    const builderMap = new Map([["test-skill", builder]]);
    const handler = new SkillHandler(
      mockSkill,
      { execute: vi.fn() } as any,
      builderMap,
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      makeTraceStore(),
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      makeContextResolver(),
    );
    await expect(handler.onMessage!(makeCtx())).rejects.toThrow("DB down");
  });

  it("persists trace after execution", async () => {
    const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
    const traceStore = makeTraceStore();
    const executor = { execute: vi.fn().mockResolvedValue(makeExecutorResult()) };
    const handler = new SkillHandler(
      mockSkill,
      executor as any,
      new Map([["test-skill", builder]]),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      traceStore,
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      makeContextResolver(),
    );

    await handler.onMessage!(makeCtx());
    expect(traceStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "d1",
        organizationId: "org1",
        skillSlug: "test-skill",
        status: "success",
      }),
    );
  });

  it("blocks execution when circuit breaker trips", async () => {
    const executor = { execute: vi.fn() };
    const handler = new SkillHandler(
      mockSkill,
      executor as any,
      new Map([["test-skill", vi.fn()]]),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      makeTraceStore(),
      makeCircuitBreaker(false),
      makeBlastRadius(),
      makeOutcomeLinker(),
      makeContextResolver(),
    );

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(executor.execute).not.toHaveBeenCalled();
    expect(ctx.chat.send).toHaveBeenCalledWith(expect.stringContaining("trouble"));
  });

  it("blocks execution when blast radius limit reached", async () => {
    const executor = { execute: vi.fn() };
    const handler = new SkillHandler(
      mockSkill,
      executor as any,
      new Map([["test-skill", vi.fn()]]),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      makeTraceStore(),
      makeCircuitBreaker(),
      makeBlastRadius(false),
      makeOutcomeLinker(),
      makeContextResolver(),
    );

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(executor.execute).not.toHaveBeenCalled();
    expect(ctx.chat.send).toHaveBeenCalledWith(expect.stringContaining("active"));
  });

  it("persists error trace when executor throws", async () => {
    const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
    const traceStore = makeTraceStore();
    const { SkillExecutionBudgetError } = await import("./types.js");
    const executor = {
      execute: vi.fn().mockRejectedValue(new SkillExecutionBudgetError("Exceeded 30s")),
    };
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = new SkillHandler(
      mockSkill,
      executor as any,
      new Map([["test-skill", builder]]),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      traceStore,
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      makeContextResolver(),
    );

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(traceStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "budget_exceeded",
        error: "Exceeded 30s",
      }),
    );
    expect(ctx.chat.send).toHaveBeenCalledWith(expect.stringContaining("issue"));
    consoleErrorSpy.mockRestore();
  });

  it("still sends response when trace persistence fails", async () => {
    const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
    const traceStore = makeTraceStore();
    traceStore.create.mockRejectedValue(new Error("DB down"));
    const executor = { execute: vi.fn().mockResolvedValue(makeExecutorResult()) };
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = new SkillHandler(
      mockSkill,
      executor as any,
      new Map([["test-skill", builder]]),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      traceStore,
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      makeContextResolver(),
    );

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(ctx.chat.send).toHaveBeenCalledWith("Hello Alice");
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("merges resolved context variables into execution parameters", async () => {
    const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
    const contextResolver = {
      resolve: vi.fn().mockResolvedValue({ variables: { BRAND_VOICE: "friendly" }, metadata: [] }),
    };
    const executor = { execute: vi.fn().mockResolvedValue(makeExecutorResult()) };
    const handler = new SkillHandler(
      mockSkill,
      executor as any,
      new Map([["test-skill", builder]]),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      makeTraceStore(),
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      contextResolver as any,
    );

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(contextResolver.resolve).toHaveBeenCalledWith("org1", mockSkill.context);
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: { NAME: "Alice", BRAND_VOICE: "friendly" },
      }),
    );
  });

  it("fails before LLM call when required context is missing", async () => {
    const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
    const { ContextResolutionError } = await import("./types.js");
    const contextResolver = {
      resolve: vi.fn().mockRejectedValue(new ContextResolutionError("policy", "global")),
    };
    const executor = { execute: vi.fn() };
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = new SkillHandler(
      mockSkill,
      executor as any,
      new Map([["test-skill", builder]]),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      makeTraceStore(),
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      contextResolver as any,
    );

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(executor.execute).not.toHaveBeenCalled();
    expect(ctx.chat.send).toHaveBeenCalledWith(
      "I'm missing some required setup. Please contact your admin to configure knowledge entries.",
    );
    consoleErrorSpy.mockRestore();
  });

  it("proceeds normally when no context requirements exist", async () => {
    const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
    const executor = { execute: vi.fn().mockResolvedValue(makeExecutorResult()) };
    const handler = new SkillHandler(
      { ...mockSkill, context: [] },
      executor as any,
      new Map([["test-skill", builder]]),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1", sessionId: "sess-1" },
      makeTraceStore(),
      makeCircuitBreaker(),
      makeBlastRadius(),
      makeOutcomeLinker(),
      makeContextResolver(),
    );

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(executor.execute).toHaveBeenCalled();
    expect(ctx.chat.send).toHaveBeenCalledWith("Hello Alice");
  });
});
