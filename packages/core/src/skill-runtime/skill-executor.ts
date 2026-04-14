import type { ToolCallingAdapter } from "./tool-calling-adapter.js";
import type {
  SkillExecutionParams,
  SkillExecutionResult,
  ToolCallRecord,
  SkillTool,
} from "./types.js";
import { SkillExecutionBudgetError, getToolGovernanceDecision } from "./types.js";
import { interpolate } from "./template-engine.js";
import { getGovernanceConstraints } from "./governance-injector.js";
import type Anthropic from "@anthropic-ai/sdk";

const MAX_TOOL_CALLS = 5;
const MAX_LLM_TURNS = 6;

export class SkillExecutorImpl {
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

    while (turnCount < MAX_LLM_TURNS) {
      turnCount++;
      const response = await this.adapter.chatWithTools({
        system,
        messages,
        tools: anthropicTools,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      if (response.stopReason === "end_turn" || response.stopReason === "max_tokens") {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        return {
          response: text,
          toolCalls: toolCallRecords,
          tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
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

        const governanceDecision = getToolGovernanceDecision(toolUse.name, params.trustLevel);

        let result: unknown;
        if (governanceDecision === "require-approval") {
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
          governanceDecision:
            governanceDecision === "require-approval" ? "require-approval" : "auto-approved",
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
