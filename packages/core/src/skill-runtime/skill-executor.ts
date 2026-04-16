import type { ToolCallingAdapter } from "./tool-calling-adapter.js";
import type {
  SkillExecutionParams,
  SkillExecutionResult,
  SkillExecutor,
  ToolCallRecord,
  SkillTool,
} from "./types.js";
import { SkillExecutionBudgetError } from "./types.js";
import { getToolGovernanceDecision, mapDecisionToOutcome } from "./governance.js";
import type { GovernanceLogEntry } from "./governance.js";
import { interpolate } from "./template-engine.js";
import { getGovernanceConstraints } from "./governance-injector.js";
import type Anthropic from "@anthropic-ai/sdk";

const MAX_TOOL_CALLS = 5;
const MAX_LLM_TURNS = 6;
const MAX_TOTAL_TOKENS = 64_000;
const MAX_RUNTIME_MS = 30_000;

export class SkillExecutorImpl implements SkillExecutor {
  constructor(
    private adapter: ToolCallingAdapter,
    private tools: Map<string, SkillTool>,
  ) {}

  async execute(params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const interpolated = interpolate(params.skill.body, params.parameters, params.skill.parameters);

    const system = `${interpolated}\n\n${getGovernanceConstraints()}`;

    const anthropicTools = this.buildAnthropicTools(params.skill.tools);

    const messages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const toolCallRecords: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turnCount = 0;
    const startTime = Date.now();
    const governanceLogs: GovernanceLogEntry[] = [];

    while (turnCount < MAX_LLM_TURNS) {
      turnCount++;

      const remainingMs = MAX_RUNTIME_MS - (Date.now() - startTime);
      if (remainingMs <= 0) {
        throw new SkillExecutionBudgetError("Exceeded 30s runtime limit");
      }
      let timeoutId: ReturnType<typeof setTimeout>;
      const response = await Promise.race([
        this.adapter.chatWithTools({
          system,
          messages,
          tools: anthropicTools,
        }),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(
            () => reject(new SkillExecutionBudgetError("Exceeded 30s runtime limit")),
            remainingMs,
          );
        }),
      ]).finally(() => {
        clearTimeout(timeoutId);
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      if (totalInputTokens + totalOutputTokens > MAX_TOTAL_TOKENS) {
        throw new SkillExecutionBudgetError(
          `Exceeded token budget (${totalInputTokens + totalOutputTokens} > ${MAX_TOTAL_TOKENS})`,
        );
      }

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
              const tool = this.tools.get(tc.toolId);
              const opDef = tool?.operations[tc.operation];
              return (
                opDef?.governanceTier === "internal_write" ||
                opDef?.governanceTier === "external_write"
              );
            }).length,
            governanceDecisions: governanceLogs,
          },
        };
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (toolCallRecords.length >= MAX_TOOL_CALLS) {
          throw new SkillExecutionBudgetError(`Exceeded maximum tool calls (${MAX_TOOL_CALLS})`);
        }

        const start = Date.now();
        const [toolId, ...opParts] = toolUse.name.split(".");
        const operation = opParts.join(".");
        const tool = this.tools.get(toolId!);
        const op = tool?.operations[operation];

        const governanceDecision = op
          ? getToolGovernanceDecision(op, params.trustLevel)
          : "auto-approve";

        if (op) {
          governanceLogs.push({
            operationId: `${toolId}.${operation}`,
            tier: op.governanceTier,
            trustLevel: params.trustLevel,
            decision: governanceDecision,
            overridden: !!op.governanceOverride?.[params.trustLevel],
            timestamp: new Date().toISOString(),
          });
        }

        let result: unknown;
        if (governanceDecision === "deny") {
          result = {
            status: "denied",
            message: "This action is not permitted at your current trust level.",
          };
        } else if (governanceDecision === "require-approval") {
          result = {
            status: "pending_approval",
            message: "This action requires human approval.",
          };
        } else if (op) {
          result = await op.execute(toolUse.input);
        } else {
          result = { error: `Unknown tool: ${toolUse.name}` };
        }

        toolCallRecords.push({
          toolId: toolId!,
          operation,
          params: toolUse.input,
          result,
          durationMs: Date.now() - start,
          governanceDecision: mapDecisionToOutcome(governanceDecision),
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    throw new SkillExecutionBudgetError(`Exceeded maximum LLM turns (${MAX_LLM_TURNS})`);
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
