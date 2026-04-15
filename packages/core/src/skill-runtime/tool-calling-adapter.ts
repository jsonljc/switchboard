import type Anthropic from "@anthropic-ai/sdk";

export interface ToolCallingAdapterResponse {
  content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: { inputTokens: number; outputTokens: number };
}

export interface ToolCallingAdapter {
  chatWithTools(params: {
    system: string;
    messages: Array<Anthropic.MessageParam>;
    tools: Array<Anthropic.Tool>;
    maxTokens?: number;
  }): Promise<ToolCallingAdapterResponse>;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";
const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicToolCallingAdapter implements ToolCallingAdapter {
  constructor(private client: Anthropic) {}

  async chatWithTools(params: {
    system: string;
    messages: Array<Anthropic.MessageParam>;
    tools: Array<Anthropic.Tool>;
    maxTokens?: number;
  }): Promise<ToolCallingAdapterResponse> {
    const response = await this.client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: params.system,
      messages: params.messages,
      tools: params.tools.length > 0 ? params.tools : undefined,
    });

    return {
      content: response.content as Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>,
      stopReason: response.stop_reason as "end_turn" | "tool_use" | "max_tokens",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
