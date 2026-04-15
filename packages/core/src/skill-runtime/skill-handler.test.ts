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
};

const mockStores: SkillStores = {
  opportunityStore: { findActiveByContact: vi.fn() },
  contactStore: { findById: vi.fn() },
  activityStore: { listByDeployment: vi.fn() },
};

function makeCtx() {
  return {
    persona: { businessName: "Biz" },
    conversation: { id: "conv-1", messages: [{ role: "user", content: "hi" }] },
    trust: { score: 50, level: "guided" as const },
    chat: { send: vi.fn() },
  } as any;
}

describe("SkillHandler (generic)", () => {
  it("throws when no builder registered for slug", async () => {
    const handler = new SkillHandler(
      mockSkill,
      { execute: vi.fn() } as any,
      new Map(),
      mockStores,
      { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    );
    await expect(handler.onMessage!(makeCtx())).rejects.toThrow("No parameter builder registered");
  });

  it("calls builder and executor, sends response", async () => {
    const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
    const executor = {
      execute: vi.fn().mockResolvedValue({
        response: "Hello Alice",
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
      }),
    };
    const builderMap = new Map([["test-skill", builder]]);
    const handler = new SkillHandler(mockSkill, executor as any, builderMap, mockStores, {
      deploymentId: "d1",
      orgId: "org1",
      contactId: "c1",
    });

    const ctx = makeCtx();
    await handler.onMessage!(ctx);

    expect(builder).toHaveBeenCalledWith(
      ctx,
      { deploymentId: "d1", orgId: "org1", contactId: "c1" },
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
    const handler = new SkillHandler(mockSkill, executor as any, builderMap, mockStores, {
      deploymentId: "d1",
      orgId: "org1",
    });

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
      { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    );
    await expect(handler.onMessage!(makeCtx())).rejects.toThrow("DB down");
  });
});
