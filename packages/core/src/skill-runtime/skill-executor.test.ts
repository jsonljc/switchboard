/* eslint-disable max-lines */
// Legacy-debt marker: this consolidated SkillExecutorImpl suite (interpolation,
// governance, budget/timeout, cache-token accounting, and the A5 isolated
// execution-trace recorder) exceeds 600 lines. Splitting would fragment the
// shared mock-adapter/mock-skill scaffold across files; the codebase convention
// is the eslint-disable marker over an awkward split (see calendar-book.test.ts).
import { describe, it, expect, vi } from "vitest";
import { SkillExecutorImpl, parseIntentTag } from "./skill-executor.js";
import type { ToolCallingLLMAdapter } from "./llm-types.js";
import type {
  SkillDefinition,
  SkillTool,
  SkillHookContext,
  SkillExecutionResult,
} from "./types.js";
import {
  SkillParameterError,
  SkillExecutionBudgetError,
  DEFAULT_SKILL_RUNTIME_POLICY,
} from "./types.js";
import { GovernanceHook } from "./hooks/governance-hook.js";
import { ModelRouter } from "../model-router.js";
import { ok } from "./tool-result.js";

const mockSkill: SkillDefinition = {
  name: "test",
  slug: "test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [{ name: "NAME", type: "string", required: true }],
  tools: [],
  body: "Hello {{NAME}}",
  context: [],
};

function createMockAdapter(
  responses: Array<{
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    stop_reason: string;
  }>,
): ToolCallingLLMAdapter {
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

describe("DEFAULT_SKILL_RUNTIME_POLICY budget split (C2)", () => {
  it("splits per-call vs whole-conversation budget", () => {
    // Per-call deadline (30s) bounds any single hung LLM call; the whole-
    // conversation ceiling (120s) gives a legitimate multi-tool booking room.
    expect(DEFAULT_SKILL_RUNTIME_POLICY.maxLlmCallMs).toBe(30_000);
    expect(DEFAULT_SKILL_RUNTIME_POLICY.maxRuntimeMs).toBe(120_000);
  });
});

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
    expect(result.trace).toBeDefined();
    expect(result.trace.status).toBe("success");
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
          effectCategory: "read" as const,
          execute: vi.fn().mockResolvedValue(ok({ done: true })),
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
    expect(result.trace).toBeDefined();
    expect(result.trace.status).toBe("success");
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
          effectCategory: "read" as const,
          execute: vi.fn().mockResolvedValue(ok({ ok: true })),
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
          effectCategory: "write" as const,
          execute: vi.fn().mockResolvedValue(ok({ ok: true })),
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

    const toolMap = new Map([["crm-write", mockTool]]);
    const executor = new SkillExecutorImpl(adapter, toolMap, undefined, [
      new GovernanceHook(toolMap),
    ]);

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
    expect(execResult.trace).toBeDefined();
    expect(execResult.trace.status).toBe("success");
  });

  it("handles deny governance decision", async () => {
    const toolSkill: SkillDefinition = {
      ...mockSkill,
      tools: ["dangerous-tool"],
      body: "Use dangerous-tool.delete {{NAME}}",
    };
    const dangerousTool: SkillTool = {
      id: "dangerous-tool",
      operations: {
        delete: {
          description: "delete something",
          inputSchema: { type: "object", properties: {} },
          effectCategory: "irreversible" as const,
          execute: vi.fn().mockResolvedValue(ok({ deleted: true })),
        },
      },
    };

    const adapter = createMockAdapter([
      {
        content: [{ type: "tool_use", id: "t1", name: "dangerous-tool.delete", input: {} }],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Cannot delete." }],
        stop_reason: "end_turn",
      },
    ]);

    const toolMap = new Map([["dangerous-tool", dangerousTool]]);
    const executor = new SkillExecutorImpl(adapter, toolMap, undefined, [
      new GovernanceHook(toolMap),
    ]);
    const result = await executor.execute({
      skill: toolSkill,
      parameters: { NAME: "X" },
      messages: [{ role: "user", content: "delete it" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 10,
      trustLevel: "supervised",
    });

    // Tool should NOT have been executed
    expect(dangerousTool.operations["delete"]!.execute).not.toHaveBeenCalled();
    // Record should show denied
    expect(result.toolCalls[0]!.governanceDecision).toBe("denied");
    expect(result.trace).toBeDefined();
    expect(result.trace.status).toBe("success");
  });

  it("forwards HookResult.payload to pendingApproval ToolResult (A.7c-followup)", async () => {
    // Custom hook returning decision=pending_approval with typed payload.
    // The executor must forward payload to the synthesized ToolResult.error.payload.
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
          effectCategory: "read" as const,
          execute: vi.fn().mockResolvedValue(ok({ ok: true })),
        },
      },
    };

    const payloadEmittingHook = {
      name: "regulatory-gate",
      async beforeToolCall() {
        return {
          proceed: false,
          decision: "pending_approval" as const,
          reason: "Regulatory review required",
          payload: {
            kind: "regulatory" as const,
            body: "Patient asked about FDA approval status.",
          },
        };
      },
    };

    const adapter = createMockAdapter([
      {
        content: [{ type: "tool_use", id: "t1", name: "test-tool.do", input: {} }],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Pending approval." }],
        stop_reason: "end_turn",
      },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map([["test-tool", mockTool]]), undefined, [
      payloadEmittingHook,
    ]);
    const result = await executor.execute({
      skill: toolSkill,
      parameters: { NAME: "X" },
      messages: [{ role: "user", content: "do it" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.governanceDecision).toBe("require-approval");
    expect(result.toolCalls[0]!.result.status).toBe("pending_approval");
    expect(result.toolCalls[0]!.result.error?.payload?.kind).toBe("regulatory");
    expect(result.toolCalls[0]!.result.error?.payload?.body).toBe(
      "Patient asked about FDA approval status.",
    );
  });

  it("synthesizes pendingApproval without payload when hook omits it (A.7c-followup)", async () => {
    // Backward-compat: hook returns decision=pending_approval but no payload.
    // ToolResult.error.payload must be undefined (legacy fallback path).
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
          effectCategory: "read" as const,
          execute: vi.fn().mockResolvedValue(ok({ ok: true })),
        },
      },
    };

    const noPayloadHook = {
      name: "legacy-gate",
      async beforeToolCall() {
        return {
          proceed: false,
          decision: "pending_approval" as const,
          reason: "Requires approval",
        };
      },
    };

    const adapter = createMockAdapter([
      {
        content: [{ type: "tool_use", id: "t1", name: "test-tool.do", input: {} }],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Pending." }],
        stop_reason: "end_turn",
      },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map([["test-tool", mockTool]]), undefined, [
      noPayloadHook,
    ]);
    const result = await executor.execute({
      skill: toolSkill,
      parameters: { NAME: "X" },
      messages: [{ role: "user", content: "do it" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    });

    expect(result.toolCalls[0]!.result.status).toBe("pending_approval");
    expect(result.toolCalls[0]!.result.error?.payload).toBeUndefined();
  });

  it("enforces token budget", async () => {
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
          effectCategory: "read" as const,
          execute: vi.fn().mockResolvedValue(ok({ ok: true })),
        },
      },
    };

    // Each response reports 40K input tokens — second call will exceed 64K
    let callIndex = 0;
    const bigAdapter: ToolCallingLLMAdapter = {
      chatWithTools: vi.fn().mockImplementation(() => {
        callIndex++;
        return Promise.resolve({
          content: [{ type: "tool_use", id: `t${callIndex}`, name: "test-tool.do", input: {} }],
          stopReason: "tool_use",
          usage: { inputTokens: 40_000, outputTokens: 1_000 },
        });
      }),
    };

    const executor = new SkillExecutorImpl(bigAdapter, new Map([["test-tool", mockTool]]));

    await expect(
      executor.execute({
        skill: toolSkill,
        parameters: { NAME: "X" },
        messages: [{ role: "user", content: "hi" }],
        deploymentId: "d1",
        orgId: "org1",
        trustScore: 50,
        trustLevel: "guided",
      }),
    ).rejects.toThrow(SkillExecutionBudgetError);
  });

  it("enforces runtime timeout", async () => {
    const slowAdapter: ToolCallingLLMAdapter = {
      chatWithTools: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  content: [{ type: "text", text: "too slow" }],
                  stopReason: "end_turn",
                  usage: { inputTokens: 100, outputTokens: 50 },
                }),
              35_000,
            ),
          ),
      ),
    };

    const executor = new SkillExecutorImpl(slowAdapter, new Map());

    await expect(
      executor.execute({
        skill: mockSkill,
        parameters: { NAME: "X" },
        messages: [{ role: "user", content: "hi" }],
        deploymentId: "d1",
        orgId: "org1",
        trustScore: 50,
        trustLevel: "guided",
      }),
    ).rejects.toThrow(SkillExecutionBudgetError);
  }, 40_000);

  it("returns trace data with execution metadata", async () => {
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

    expect(result.trace).toBeDefined();
    expect(result.trace.status).toBe("success");
    expect(result.trace.turnCount).toBe(1);
    expect(result.trace.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.trace.writeCount).toBe(0);
    expect(result.trace.responseSummary).toBe("Hi there");
    expect(result.trace.governanceDecisions).toEqual([]);
  });

  it("counts writes and logs governance decisions in trace data", async () => {
    const writeTool: SkillTool = {
      id: "crm-write",
      operations: {
        "stage.update": {
          description: "update stage",
          inputSchema: { type: "object", properties: {} },
          effectCategory: "write" as any,
          execute: vi.fn().mockResolvedValue(ok({ stage: "qualified" })),
        },
      },
    };

    const toolSkill: SkillDefinition = {
      ...mockSkill,
      tools: ["crm-write"],
      body: "Update stage {{NAME}}",
    };

    const adapter = createMockAdapter([
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "crm-write.stage.update",
            input: { stage: "qualified" },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Stage updated." }],
        stop_reason: "end_turn",
      },
    ]);

    const toolMap = new Map([["crm-write", writeTool]]);
    const executor = new SkillExecutorImpl(adapter, toolMap, undefined, [
      new GovernanceHook(toolMap),
    ]);
    const result = await executor.execute({
      skill: toolSkill,
      parameters: { NAME: "X" },
      messages: [{ role: "user", content: "update" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    });

    expect(result.trace.writeCount).toBe(1);
    expect(result.trace.governanceDecisions).toHaveLength(1);
    expect(result.trace.governanceDecisions[0]!.tier).toBe("write");
  });

  it("accumulates cache tokens + model and keeps the budget on full-price tokens", async () => {
    // A large cache_read (5000) plus tiny full-price input+output (120) must NOT
    // trip the 64k budget — the budget gates on billable (uncached) tokens only.
    const adapter: ToolCallingLLMAdapter = {
      chatWithTools: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Hi there" }],
        stopReason: "end_turn",
        model: "claude-sonnet-4-6",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 5000,
          cacheCreationTokens: 0,
        },
      }),
    };

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

    expect(result.tokenUsage.cacheRead).toBe(5000);
    expect(result.tokenUsage.cacheCreation).toBe(0);
    expect(result.trace.model).toBe("claude-sonnet-4-6");
    // large cache_read must NOT trip the 64k budget (full-price input+output is only 120):
    expect(result.trace.status).toBe("success");
  });

  // --- A5: isolated execution-trace recorder (8th constructor arg) ---

  const traceBaseParams = () => ({
    skill: mockSkill,
    parameters: { NAME: "Alice" },
    messages: [{ role: "user" as const, content: "hello" }],
    deploymentId: "d1",
    orgId: "org1",
    trustScore: 50,
    trustLevel: "guided" as const,
  });

  const okTraceAdapter = (): ToolCallingLLMAdapter => ({
    chatWithTools: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Hi there" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
  });

  it("invokes the execution trace hook with the result on success", async () => {
    const calls: SkillExecutionResult[] = [];
    const traceHook = {
      afterSkill: async (_c: SkillHookContext, r: SkillExecutionResult) => {
        calls.push(r);
      },
      onError: async () => {},
    };
    const exec = new SkillExecutorImpl(
      okTraceAdapter(),
      new Map(),
      undefined,
      [],
      undefined,
      new Map(),
      undefined,
      traceHook,
    );
    const result = await exec.execute(traceBaseParams());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(result);
    expect(calls[0]!.tokenUsage.input).toBe(10);
  });

  it("a throwing trace hook does NOT break the response", async () => {
    const traceHook = {
      afterSkill: async () => {
        throw new Error("telemetry down");
      },
      onError: async () => {},
    };
    const exec = new SkillExecutorImpl(
      okTraceAdapter(),
      new Map(),
      undefined,
      [],
      undefined,
      new Map(),
      undefined,
      traceHook,
    );
    const result = await exec.execute(traceBaseParams());
    expect(result.response).toBe("Hi there");
  });

  it("invokes onError when the turn throws", async () => {
    const errors: Error[] = [];
    const traceHook = {
      afterSkill: async () => {},
      onError: async (_c: SkillHookContext, e: Error) => {
        errors.push(e);
      },
    };
    // Adapter returns large token usage; the maxTotalTokens:1 budget throws
    // SkillExecutionBudgetError on the first turn.
    const budgetBustingAdapter: ToolCallingLLMAdapter = {
      chatWithTools: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "over" }],
        stopReason: "end_turn",
        usage: { inputTokens: 1000, outputTokens: 1000 },
      }),
    };
    const exec = new SkillExecutorImpl(
      budgetBustingAdapter,
      new Map(),
      undefined,
      [],
      { ...DEFAULT_SKILL_RUNTIME_POLICY, maxLlmTurns: 1, maxTotalTokens: 1 },
      new Map(),
      undefined,
      traceHook,
    );
    await expect(exec.execute(traceBaseParams())).rejects.toThrow(SkillExecutionBudgetError);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SkillExecutionBudgetError);
  });

  // --- B2: conversation-depth tiering (router ON) ---

  // Records the profile.model the executor resolved for each LLM call.
  const recordingAdapter = (seen: Array<string | undefined>): ToolCallingLLMAdapter => ({
    chatWithTools: vi.fn().mockImplementation((p: { profile?: { model?: string } }) => {
      seen.push(p.profile?.model);
      return Promise.resolve({
        content: [{ type: "text", text: "ok" }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    }),
  });

  // An Alex-shaped tool map: a single high-risk tool (external_mutation) so
  // buildTierContext's hasHighRiskTools is true and toolCount > 0.
  const alexLikeTools = (): Map<string, SkillTool> =>
    new Map<string, SkillTool>([
      [
        "calendar-book",
        {
          id: "calendar-book",
          operations: {
            "booking.create": {
              description: "Book an appointment.",
              effectCategory: "external_mutation" as const,
              idempotent: false,
              inputSchema: { type: "object", properties: {}, required: [] },
              execute: async () => ok({}),
            },
          },
        },
      ],
    ]);

  const alexLikeSkill: SkillDefinition = {
    ...mockSkill,
    parameters: [],
    tools: ["calendar-book"],
    body: "Help the customer book.",
  };

  // 8 alternating user/assistant messages; the FINAL user message is neutral —
  // no price/trust/timing/fear/comparison keyword and no ready-now phrasing — so
  // classifyEmotionalSignal yields no stage. This proves the conversation-DEPTH
  // re-key (not the stage-raise) is what routes a deep turn to Sonnet.
  const deepNeutralMessages = (
    count: number,
  ): Array<{ role: "user" | "assistant"; content: string }> => {
    const msgs: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (let i = 0; i < count - 1; i++) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: i % 2 === 0 ? "Tell me about the treatment options." : "Here are the options.",
      });
    }
    msgs.push({ role: "user", content: "ok, and what would the next step look like for me?" });
    return msgs;
  };

  it("routes a deep neutral turn to Sonnet (premium), not Haiku, when the router is ON", async () => {
    const seen: Array<string | undefined> = [];
    const exec = new SkillExecutorImpl(
      recordingAdapter(seen),
      alexLikeTools(),
      new ModelRouter(),
      [],
    );
    await exec.execute({
      skill: alexLikeSkill,
      parameters: {},
      messages: deepNeutralMessages(8),
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 100,
      trustLevel: "autonomous",
      sessionId: "s1",
    });
    expect(seen[0]).toBe("claude-sonnet-4-6");
    expect(seen[0]).not.toBe("claude-haiku-4-5-20251001");
  });

  it("routes a first-contact greeting to Haiku (default) when the router is ON", async () => {
    const seen: Array<string | undefined> = [];
    const exec = new SkillExecutorImpl(
      recordingAdapter(seen),
      alexLikeTools(),
      new ModelRouter(),
      [],
    );
    await exec.execute({
      skill: alexLikeSkill,
      parameters: {},
      messages: [{ role: "user", content: "hi there" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 100,
      trustLevel: "autonomous",
      sessionId: "s1",
    });
    expect(seen[0]).toBe("claude-haiku-4-5-20251001");
  });
});

describe("parseIntentTag", () => {
  it("0 tags → cleaned text, null intentClass", () => {
    const r = parseIntentTag("See you at 3pm.");
    expect(r.text).toBe("See you at 3pm.");
    expect(r.intentClass).toBeNull();
  });

  it("1 valid trailing tag → strip + use", () => {
    const r = parseIntentTag("See you at 3pm. <intent>appointment-confirm</intent>");
    expect(r.text).toBe("See you at 3pm.");
    expect(r.intentClass).toBe("appointment-confirm");
  });

  it("strips the tag even when surrounded by whitespace/newlines", () => {
    const r = parseIntentTag("See you.\n\n  <intent>aftercare-checkin</intent>  \n");
    expect(r.text).toBe("See you.");
    expect(r.intentClass).toBe("aftercare-checkin");
  });

  it("unknown tag value → strip tag, null intentClass", () => {
    const r = parseIntentTag("See you. <intent>fooobar</intent>");
    expect(r.text).toBe("See you.");
    expect(r.intentClass).toBeNull();
  });

  it("multiple tags (regardless of validity) → strip ALL tags, null intentClass", () => {
    const r = parseIntentTag(
      "Booked. <intent>appointment-confirm</intent> Or maybe <intent>appointment-reminder</intent>",
    );
    expect(r.intentClass).toBeNull();
    expect(r.text).not.toMatch(/<intent>/);
    expect(r.text).not.toMatch(/<\/intent>/);
  });

  it("multiple tags with mixed validity → still null + strip all", () => {
    const r = parseIntentTag(
      "Hello. <intent>foo</intent> world <intent>appointment-confirm</intent>",
    );
    expect(r.intentClass).toBeNull();
    expect(r.text).not.toMatch(/<\/?intent>/);
  });

  it("malformed tag (unclosed) is left in place; intentClass null", () => {
    const r = parseIntentTag("See you. <intent>appointment-confirm");
    expect(r.intentClass).toBeNull();
    expect(r.text).toContain("<intent>");
  });

  it("single tag not at the trailing edge is still recognized as one tag", () => {
    const r = parseIntentTag("Welcome <intent>consult-followup</intent> back!");
    expect(r.intentClass).toBe("consult-followup");
    expect(r.text).not.toMatch(/<\/?intent>/);
    expect(r.text).toMatch(/Welcome/);
    expect(r.text).toMatch(/back!/);
  });
});
