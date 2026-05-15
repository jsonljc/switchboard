import type Anthropic from "@anthropic-ai/sdk";
import {
  LLMAdapterShapeMismatchError,
  type ToolCallingLLMAdapter,
  type LLMMessage,
  type LLMToolDefinition,
  type LLMResponse,
  type LLMContentBlock,
  type LLMStopReason,
} from "../llm-types.js";

// Track current Anthropic model defaults centrally. Do not propagate the
// pre-existing stale `claude-sonnet-4-5-20250514` literal from
// tool-calling-adapter.ts into this new adapter — updating that legacy file's
// default is a separate cleanup outside PR-4 scope.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const PROVIDER = "anthropic";

const KNOWN_STOP_REASONS: ReadonlySet<LLMStopReason> = new Set([
  "end_turn",
  "tool_use",
  "max_tokens",
]);

export class AnthropicToolAdapter implements ToolCallingLLMAdapter {
  constructor(private client: Anthropic) {}

  async chatWithTools(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDefinition[];
    maxTokens?: number;
    profile?: { model: string; maxTokens: number; temperature: number; timeoutMs: number };
  }): Promise<LLMResponse> {
    const anthropicMessages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role,
      content: m.content as Anthropic.MessageParam["content"],
    }));

    const anthropicTools: Anthropic.Tool[] | undefined =
      params.tools.length > 0
        ? params.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          }))
        : undefined;

    const response = await this.client.messages.create({
      model: params.profile?.model ?? DEFAULT_MODEL,
      max_tokens: params.profile?.maxTokens ?? params.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: params.system,
      messages: anthropicMessages,
      tools: anthropicTools,
      ...(params.profile?.temperature !== undefined && {
        temperature: params.profile.temperature,
      }),
    });

    // Translate content blocks. Unknown block types MUST surface as a typed
    // adapter error — silent coercion to empty text hides provider mismatches.
    const content: LLMContentBlock[] = response.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      throw new LLMAdapterShapeMismatchError(PROVIDER, "content_block", String(block.type));
    });

    // Translate stop_reason. Unknown reasons MUST surface — Anthropic adds
    // new ones (`refusal`, `pause_turn`, etc.) and silent coercion to "end_turn"
    // would hide premature stops.
    if (!KNOWN_STOP_REASONS.has(response.stop_reason as LLMStopReason)) {
      throw new LLMAdapterShapeMismatchError(PROVIDER, "stop_reason", String(response.stop_reason));
    }

    return {
      content,
      stopReason: response.stop_reason as LLMStopReason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
