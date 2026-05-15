import type {
  ToolCallingLLMAdapter,
  LLMMessage,
  LLMToolDefinition,
  LLMResponse,
} from "../llm-types.js";

export class TestToolAdapter implements ToolCallingLLMAdapter {
  private responses: LLMResponse[];
  private callIndex = 0;
  public readonly calls: Array<{
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDefinition[];
  }> = [];

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  async chatWithTools(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDefinition[];
  }): Promise<LLMResponse> {
    this.calls.push({
      system: params.system,
      messages: params.messages,
      tools: params.tools,
    });

    if (this.callIndex >= this.responses.length) {
      throw new Error(
        `TestToolAdapter: no more responses (call ${this.callIndex + 1}, have ${this.responses.length})`,
      );
    }

    return this.responses[this.callIndex++]!;
  }
}
