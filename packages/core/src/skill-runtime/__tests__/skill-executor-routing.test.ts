import { describe, it, expect, vi } from "vitest";
import { SkillExecutorImpl } from "../skill-executor.js";
import { ModelRouter } from "../../model-router.js";
import type { ToolCallingLLMAdapter, LLMResponse, LLMTextBlock } from "../llm-types.js";
import type { SkillDefinition, SkillExecutionParams } from "../types.js";

function makeEndTurnResponse(text: string): LLMResponse {
  return {
    content: [{ type: "text", text } as LLMTextBlock],
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
    const mockAdapter: ToolCallingLLMAdapter = {
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
    const mockAdapter: ToolCallingLLMAdapter = {
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
    const mockAdapter: ToolCallingLLMAdapter = {
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

  // Full chain: messages → classifyEmotionalSignal → emotionalSignalToStage →
  // TierContext.currentStage → resolveTier → resolved profile model.
  async function modelForMessages(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<string | undefined> {
    const mockAdapter: ToolCallingLLMAdapter = {
      chatWithTools: vi.fn().mockResolvedValue(makeEndTurnResponse("done")),
    };
    const executor = new SkillExecutorImpl(mockAdapter, new Map(), new ModelRouter());
    await executor.execute({
      skill: minimalSkill,
      parameters: {},
      messages,
      deploymentId: "dep-1",
      orgId: "org-1",
      trustScore: 50,
      trustLevel: "guided",
    });
    const call = (mockAdapter.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    return call?.profile?.model;
  }

  it("full chain: ready_now message → closing → premium (sonnet)", async () => {
    expect(await modelForMessages([{ role: "user", content: "can I book now?" }])).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("full chain: fear message → critical (opus)", async () => {
    expect(await modelForMessages([{ role: "user", content: "I'm terrified of the pain" }])).toBe(
      "claude-opus-4-6",
    );
  });

  it("fear is bounded: a price-laden message stays premium, not critical", async () => {
    expect(
      await modelForMessages([{ role: "user", content: "scared the price is too high" }]),
    ).toBe("claude-sonnet-4-6");
  });

  it("defensive: no user message (assistant only) → no stage → default haiku", async () => {
    expect(await modelForMessages([{ role: "assistant", content: "hello there" }])).toBe(
      "claude-haiku-4-5-20251001",
    );
  });

  it("defensive: whitespace-only user text → no stage → default haiku", async () => {
    expect(await modelForMessages([{ role: "user", content: "   " }])).toBe(
      "claude-haiku-4-5-20251001",
    );
  });
});
