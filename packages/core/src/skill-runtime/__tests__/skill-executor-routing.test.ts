import { describe, it, expect, vi } from "vitest";
import { SkillExecutorImpl } from "../skill-executor.js";
import { ModelRouter } from "../../model-router.js";
import type { ToolCallingAdapter, ToolCallingAdapterResponse } from "../tool-calling-adapter.js";
import type { SkillDefinition, SkillExecutionParams } from "../types.js";
import type Anthropic from "@anthropic-ai/sdk";

function makeEndTurnResponse(text: string): ToolCallingAdapterResponse {
  return {
    content: [{ type: "text", text } as Anthropic.TextBlock],
    stopReason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

const minimalSkill: SkillDefinition = {
  name: "test",
  slug: "test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [],
  tools: [],
  body: "You are a test skill.",
  context: [],
};

describe("SkillExecutorImpl - ModelRouter integration", () => {
  it("resolves model via router when provided", async () => {
    const mockAdapter: ToolCallingAdapter = {
      chatWithTools: vi.fn().mockResolvedValue(makeEndTurnResponse("done")),
    };

    const router = new ModelRouter();
    const executor = new SkillExecutorImpl(mockAdapter, new Map(), router);

    const params: SkillExecutionParams = {
      skill: minimalSkill,
      parameters: {},
      messages: [{ role: "user", content: "test" }],
      deploymentId: "dep-1",
      orgId: "org-1",
      trustScore: 50,
      trustLevel: "guided",
    };

    await executor.execute(params);

    expect(mockAdapter.chatWithTools).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          model: "claude-haiku-4-5-20251001",
        }),
      }),
    );
  });

  it("uses premium model when skill has minimumModelTier: premium", async () => {
    const mockAdapter: ToolCallingAdapter = {
      chatWithTools: vi.fn().mockResolvedValue(makeEndTurnResponse("done")),
    };

    const router = new ModelRouter();
    const executor = new SkillExecutorImpl(mockAdapter, new Map(), router);

    const premiumSkill: SkillDefinition = {
      ...minimalSkill,
      minimumModelTier: "premium",
    };

    const params: SkillExecutionParams = {
      skill: premiumSkill,
      parameters: {},
      messages: [{ role: "user", content: "test" }],
      deploymentId: "dep-1",
      orgId: "org-1",
      trustScore: 50,
      trustLevel: "guided",
    };

    await executor.execute(params);

    expect(mockAdapter.chatWithTools).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          model: "claude-sonnet-4-6",
        }),
      }),
    );
  });

  it("falls back to hardcoded behavior when no router provided", async () => {
    const mockAdapter: ToolCallingAdapter = {
      chatWithTools: vi.fn().mockResolvedValue(makeEndTurnResponse("done")),
    };

    const executor = new SkillExecutorImpl(mockAdapter, new Map());

    const params: SkillExecutionParams = {
      skill: minimalSkill,
      parameters: {},
      messages: [{ role: "user", content: "test" }],
      deploymentId: "dep-1",
      orgId: "org-1",
      trustScore: 50,
      trustLevel: "guided",
    };

    await executor.execute(params);

    expect(mockAdapter.chatWithTools).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: undefined,
      }),
    );
  });
});
