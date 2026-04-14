import { describe, it, expect, vi } from "vitest";
import { SkillExecutorImpl } from "./skill-executor.js";
import type { ToolCallingAdapter } from "./tool-calling-adapter.js";
import type { SkillDefinition, SkillTool } from "./types.js";
import { SkillParameterError, SkillExecutionBudgetError } from "./types.js";

const mockSkill: SkillDefinition = {
  name: "test",
  slug: "test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [{ name: "NAME", type: "string", required: true }],
  tools: [],
  body: "Hello {{NAME}}",
};

function createMockAdapter(
  responses: Array<{
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    stop_reason: string;
  }>,
): ToolCallingAdapter {
  let callIndex = 0;
  return {
    chatWithTools: vi.fn().mockImplementation(() => {
      const resp = responses[callIndex]!;
      callIndex++;
      return Promise.resolve({
        content: resp.content,
        stopReason: resp.stop_reason,
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    }),
  };
}

describe("SkillExecutorImpl", () => {
  it("interpolates params and calls adapter with governance constraints", async () => {
    const adapter = createMockAdapter([
      {
        content: [{ type: "text", text: "Hi there" }],
        stop_reason: "end_turn",
      },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map());
    const result = await executor.execute({
      skill: mockSkill,
      parameters: { NAME: "Alice" },
      messages: [{ role: "user", content: "hello" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    });

    expect(result.response).toBe("Hi there");
    expect(result.toolCalls).toHaveLength(0);
    const callArgs = (adapter.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      system: string;
    };
    expect(callArgs.system).toContain("Hello Alice");
    expect(callArgs.system).toContain("MANDATORY RULES");
    expect(callArgs.system).toContain("Never claim to be human");
  });

  it("throws SkillParameterError for missing required param", async () => {
    const adapter = createMockAdapter([]);
    const executor = new SkillExecutorImpl(adapter, new Map());
    await expect(
      executor.execute({
        skill: mockSkill,
        parameters: {},
        messages: [],
        deploymentId: "d1",
        orgId: "org1",
        trustScore: 50,
        trustLevel: "guided",
      }),
    ).rejects.toThrow(SkillParameterError);
  });

  it("executes tool calls in a loop", async () => {
    const toolSkill: SkillDefinition = {
      ...mockSkill,
      tools: ["test-tool"],
      body: "Use test-tool.do to help {{NAME}}",
    };
    const mockTool: SkillTool = {
      id: "test-tool",
      operations: {
        do: {
          description: "do something",
          inputSchema: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue({ done: true }),
        },
      },
    };

    const adapter = createMockAdapter([
      {
        content: [{ type: "tool_use", id: "t1", name: "test-tool.do", input: {} }],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Done!" }],
        stop_reason: "end_turn",
      },
    ]);

    const toolMap = new Map([["test-tool", mockTool]]);
    const executor = new SkillExecutorImpl(adapter, toolMap);
    const result = await executor.execute({
      skill: toolSkill,
      parameters: { NAME: "Bob" },
      messages: [{ role: "user", content: "help" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    });

    expect(result.response).toBe("Done!");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.toolId).toBe("test-tool");
    expect(result.toolCalls[0]!.operation).toBe("do");
    expect(mockTool.operations["do"]!.execute).toHaveBeenCalled();
  });

  it("enforces max tool calls budget", async () => {
    const toolSkill: SkillDefinition = {
      ...mockSkill,
      tools: ["test-tool"],
      body: "Use test-tool.do {{NAME}}",
    };
    const mockTool: SkillTool = {
      id: "test-tool",
      operations: {
        do: {
          description: "do",
          inputSchema: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    };

    const responses = Array.from({ length: 10 }, (_, i) => ({
      content: [{ type: "tool_use" as const, id: `t${i}`, name: "test-tool.do", input: {} }],
      stop_reason: "tool_use",
    }));

    const adapter = createMockAdapter(responses);
    const executor = new SkillExecutorImpl(adapter, new Map([["test-tool", mockTool]]));

    await expect(
      executor.execute({
        skill: toolSkill,
        parameters: { NAME: "X" },
        messages: [{ role: "user", content: "go" }],
        deploymentId: "d1",
        orgId: "org1",
        trustScore: 50,
        trustLevel: "guided",
      }),
    ).rejects.toThrow(SkillExecutionBudgetError);
  });

  it("records governance decision for tool calls", async () => {
    const toolSkill: SkillDefinition = {
      ...mockSkill,
      tools: ["crm-write"],
      body: "Use crm-write.stage.update {{NAME}}",
    };
    const mockTool: SkillTool = {
      id: "crm-write",
      operations: {
        "stage.update": {
          description: "update stage",
          inputSchema: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    };

    const adapter = createMockAdapter([
      {
        content: [{ type: "tool_use", id: "t1", name: "crm-write.stage.update", input: {} }],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Updated" }],
        stop_reason: "end_turn",
      },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map([["crm-write", mockTool]]));

    const execResult = await executor.execute({
      skill: toolSkill,
      parameters: { NAME: "X" },
      messages: [{ role: "user", content: "update" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 10,
      trustLevel: "supervised",
    });

    expect(execResult.toolCalls[0]!.governanceDecision).toBe("require-approval");
    expect(execResult.toolCalls[0]!.toolId).toBe("crm-write");
    expect(execResult.toolCalls[0]!.operation).toBe("stage.update");
  });
});
