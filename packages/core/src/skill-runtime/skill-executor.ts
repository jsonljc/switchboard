import type { ToolCallingAdapter } from "./tool-calling-adapter.js";
import type {
  SkillExecutionParams,
  SkillExecutionResult,
  SkillExecutor,
  ToolCallRecord,
  SkillTool,
  SkillToolFactory,
  SkillHook,
  ResolvedModelProfile,
  SkillRuntimePolicy,
  SkillRequestContext,
} from "./types.js";
import { SkillExecutionBudgetError, DEFAULT_SKILL_RUNTIME_POLICY } from "./types.js";
import type { GovernanceLogEntry } from "./governance.js";
import { interpolate } from "./template-engine.js";
import { getGovernanceConstraints } from "./governance-injector.js";
import { denied, pendingApproval, fail, ok } from "./tool-result.js";
import type { ToolResult } from "./tool-result.js";
import { filterForReinjection, DEFAULT_REINJECTION_POLICY } from "./reinjection-filter.js";
import type { SkillToolOperation } from "./types.js";
import { validateToolInput, redactInputForLog } from "./input-schema-validator.js";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelRouter } from "../model-router.js";
import { buildTierContext } from "./skill-tier-context-builder.js";
import { GovernanceHook } from "./hooks/governance-hook.js";
import {
  runBeforeLlmCallHooks,
  runAfterLlmCallHooks,
  runBeforeToolCallHooks,
  runAfterToolCallHooks,
} from "./hook-runner.js";

const FALLBACK_READ_OP: SkillToolOperation = {
  description: "",
  inputSchema: {},
  effectCategory: "read",
  execute: async () => ok(),
};

// Escape sentinel-confusable substrings so tool output can't close the wrapper
// early. Replaces the ASCII angle brackets in `<|` / `|>` with Unicode
// mathematical angle brackets (U+27E8/U+27E9) — distinct glyphs to the model.
function escapeSentinel(value: string): string {
  return value.replaceAll("<|", "⟨|").replaceAll("|>", "|⟩");
}

export class SkillExecutorImpl implements SkillExecutor {
  constructor(
    private adapter: ToolCallingAdapter,
    private tools: Map<string, SkillTool>,
    private router?: ModelRouter,
    private hooks: SkillHook[] = [],
    private policy: SkillRuntimePolicy = DEFAULT_SKILL_RUNTIME_POLICY,
    /**
     * Per-request tool factories. When a tool id is present here, the executor
     * materializes a fresh `SkillTool` for each `execute()` call with a trusted
     * `SkillRequestContext` closed in. This is the canonical path; the
     * `tools` map is retained for schema-only registration (`buildAnthropicTools`)
     * and for tools with no per-request trust context.
     */
    private toolFactories: Map<string, SkillToolFactory> = new Map(),
  ) {}

  /**
   * Materialize the per-request tool map. Factories override schema-only
   * registrations on the same id. The returned map is what tool execution
   * dispatches against — never `this.tools` directly.
   */
  private materializeRuntimeTools(ctx: SkillRequestContext): Map<string, SkillTool> {
    const runtime = new Map<string, SkillTool>(this.tools);
    for (const [id, factory] of this.toolFactories.entries()) {
      runtime.set(id, factory(ctx));
    }
    return runtime;
  }

  private buildRequestContext(params: SkillExecutionParams): SkillRequestContext {
    return {
      sessionId: params.sessionId ?? `${params.deploymentId}-${Date.now()}`,
      orgId: params.orgId,
      deploymentId: params.deploymentId,
    };
  }

  private resolveProfile(
    params: SkillExecutionParams,
    turnCount: number,
    toolCallRecords: ToolCallRecord[],
    governanceHook?: GovernanceHook,
  ): ResolvedModelProfile | undefined {
    if (!this.router) return undefined;

    const logs: GovernanceLogEntry[] = governanceHook?.getGovernanceLogs() ?? [];
    const tierCtx = buildTierContext({
      turnCount: turnCount - 1,
      declaredToolIds: params.skill.tools,
      tools: this.tools,
      previousTurnHadToolUse: turnCount > 1 && toolCallRecords.length > 0,
      previousTurnEscalated: logs.some(
        (log) => log.decision === "require-approval" || log.decision === "deny",
      ),
      minimumModelTier: params.skill.minimumModelTier,
    });
    const slot = this.router.resolveTier(tierCtx);
    const modelConfig = this.router.resolve(slot);
    return {
      model: modelConfig.modelId,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
      timeoutMs: modelConfig.timeoutMs,
    };
  }

  async execute(params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const governanceHook = this.hooks.find((h): h is GovernanceHook => h.name === "governance") as
      | GovernanceHook
      | undefined;

    const interpolated = interpolate(params.skill.body, params.parameters, params.skill.parameters);

    const system = `${interpolated}\n\n${getGovernanceConstraints()}`;

    const anthropicTools = this.buildAnthropicTools(params.skill.tools);

    // Materialize per-request tools with trusted SkillRequestContext closed in.
    // Tool factories produce a fresh SkillTool per execution so trust-bound
    // identifiers (orgId, deploymentId, sessionId) cannot be supplied by the LLM.
    const requestCtx = this.buildRequestContext(params);
    const runtimeTools = this.materializeRuntimeTools(requestCtx);

    const messages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const toolCallRecords: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turnCount = 0;
    const startTime = Date.now();

    while (turnCount < this.policy.maxLlmTurns) {
      turnCount++;

      const profile = this.resolveProfile(params, turnCount, toolCallRecords, governanceHook);

      const llmCtx = {
        turnCount,
        totalInputTokens,
        totalOutputTokens,
        elapsedMs: Date.now() - startTime,
        profile,
      };
      const hookResult = await runBeforeLlmCallHooks(this.hooks, llmCtx);
      if (!hookResult.proceed) {
        throw new SkillExecutionBudgetError(hookResult.reason ?? "Aborted by hook");
      }
      const resolvedCtx = hookResult.ctx ?? llmCtx;

      // BudgetEnforcementHook checks elapsed time *before* the LLM call starts.
      // This inline check guards the gap: if time expired between hook check and here,
      // or during a long tool execution in the previous turn, catch it before starting
      // the LLM call. The Promise.race timeout below catches calls that run too long.
      const remainingMs = this.policy.maxRuntimeMs - (Date.now() - startTime);
      if (remainingMs <= 0) {
        throw new SkillExecutionBudgetError(
          `Exceeded ${this.policy.maxRuntimeMs / 1000}s runtime limit`,
        );
      }
      let timeoutId: ReturnType<typeof setTimeout>;
      const response = await Promise.race([
        this.adapter.chatWithTools({
          system,
          messages,
          tools: anthropicTools,
          profile,
        }),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new SkillExecutionBudgetError(
                  `Exceeded ${this.policy.maxRuntimeMs / 1000}s runtime limit`,
                ),
              ),
            remainingMs,
          );
        }),
      ]).finally(() => {
        clearTimeout(timeoutId);
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      if (totalInputTokens + totalOutputTokens > this.policy.maxTotalTokens) {
        throw new SkillExecutionBudgetError(
          `Exceeded token budget (${totalInputTokens + totalOutputTokens} > ${this.policy.maxTotalTokens})`,
        );
      }

      await runAfterLlmCallHooks(this.hooks, resolvedCtx, {
        content: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
      });

      if (response.stopReason === "end_turn" || response.stopReason === "max_tokens") {
        const responseText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        return {
          response: responseText,
          toolCalls: toolCallRecords,
          tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
          trace: {
            durationMs: Date.now() - startTime,
            turnCount,
            status: "success" as const,
            responseSummary: responseText.slice(0, 500),
            writeCount: toolCallRecords.filter((tc) => {
              const tool = runtimeTools.get(tc.toolId);
              const opDef = tool?.operations[tc.operation];
              return (
                opDef?.effectCategory === "write" ||
                opDef?.effectCategory === "external_send" ||
                opDef?.effectCategory === "external_mutation"
              );
            }).length,
            governanceDecisions: governanceHook?.getGovernanceLogs() ?? [],
          },
        };
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (toolCallRecords.length >= this.policy.maxToolCalls) {
          throw new SkillExecutionBudgetError(
            `Exceeded maximum tool calls (${this.policy.maxToolCalls})`,
          );
        }

        console.warn(
          `[SkillExecutor] tool_call: ${toolUse.name} args=${JSON.stringify(toolUse.input).slice(0, 200)}`,
        );

        const start = Date.now();
        const [toolId, ...opParts] = toolUse.name.split(".");
        const operation = opParts.join(".");
        const tool = runtimeTools.get(toolId!);
        const op = tool?.operations[operation];

        const toolCtx = {
          toolId: toolId!,
          operation,
          params: toolUse.input,
          effectCategory: op?.effectCategory ?? ("read" as const),
          trustLevel: params.trustLevel,
        };
        const toolHookResult = await runBeforeToolCallHooks(this.hooks, toolCtx);

        let result: ToolResult;
        let governanceOutcome: string;

        if (!toolHookResult.proceed) {
          if (toolHookResult.substituteResult) {
            if (toolHookResult.decision) {
              throw new Error(
                `Hook invariant violated: substituteResult and decision are mutually exclusive (got decision=${toolHookResult.decision})`,
              );
            }
            result = toolHookResult.substituteResult;
            governanceOutcome = "simulated";
          } else if (toolHookResult.decision === "pending_approval") {
            result = pendingApproval(toolHookResult.reason ?? "Requires approval");
            governanceOutcome = "require-approval";
          } else {
            result = denied(toolHookResult.reason ?? "Denied by policy");
            governanceOutcome = "denied";
          }
        } else if (op) {
          // Defense-in-depth: validate LLM-supplied input against the tool's
          // declared inputSchema BEFORE invoking execute(). If validation fails
          // we surface a structured INVALID_TOOL_INPUT result and skip the
          // tool. The factory-with-context pattern is the primary safeguard;
          // this guard catches accidental schema drift / leftover fields.
          const validation = validateToolInput(op.inputSchema, toolUse.input);
          if (!validation.ok) {
            console.warn(
              `[SkillExecutor] tool_input_invalid: ${toolUse.name} issues=${validation.issues
                .join("; ")
                .slice(0, 200)} redacted=${redactInputForLog(toolUse.input)}`,
            );
            result = fail(
              "execution",
              "INVALID_TOOL_INPUT",
              `Tool input did not match declared schema: ${validation.issues.join("; ")}`,
              {
                modelRemediation:
                  "Re-issue the tool call with input matching the declared inputSchema. Do not include trust-bound identifiers (orgId, deploymentId) — those are injected by the runtime.",
                retryable: false,
              },
            );
            governanceOutcome = "auto-approved";
          } else {
            result = await op.execute(toolUse.input);
            governanceOutcome = "auto-approved";
          }
        } else {
          const availableTools = params.skill.tools
            .flatMap((tid) => {
              const t = runtimeTools.get(tid);
              return t ? Object.keys(t.operations).map((opN) => `${tid}.${opN}`) : [];
            })
            .join(", ");
          result = fail("execution", "TOOL_NOT_FOUND", `Unknown tool: ${toolUse.name}`, {
            modelRemediation: `Available tools for this skill: ${availableTools}`,
            retryable: false,
          });
          governanceOutcome = "auto-approved";
        }

        await runAfterToolCallHooks(this.hooks, toolCtx, result);

        toolCallRecords.push({
          toolId: toolId!,
          operation,
          params: toolUse.input,
          result,
          durationMs: Date.now() - start,
          governanceDecision: governanceOutcome as ToolCallRecord["governanceDecision"],
        });

        const decision = filterForReinjection(
          result,
          op ?? FALLBACK_READ_OP,
          DEFAULT_REINJECTION_POLICY,
        );
        // Defense-in-depth: wrap re-injected tool output in sentinels so the
        // model treats untrusted tool content as data, not instructions.
        // Escape sentinel-confusable substrings inside the payload so
        // attacker-controlled tool content can't close the wrapper early.
        const wrappedContent = `<|tool-output|>\n${escapeSentinel(decision.content)}\n<|/tool-output|>`;
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: wrappedContent,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    throw new SkillExecutionBudgetError(`Exceeded maximum LLM turns (${this.policy.maxLlmTurns})`);
  }

  private buildAnthropicTools(toolIds: string[]): Anthropic.Tool[] {
    const result: Anthropic.Tool[] = [];
    for (const toolId of toolIds) {
      const tool = this.tools.get(toolId);
      if (!tool) continue;
      for (const [opName, op] of Object.entries(tool.operations)) {
        result.push({
          name: `${toolId}.${opName}`,
          description: op.description,
          input_schema: op.inputSchema as Anthropic.Tool.InputSchema,
        });
      }
    }
    return result;
  }
}
