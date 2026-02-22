import { LLMInterpreter } from "./llm-base.js";
import type { LLMConfig, LLMResponse } from "./llm-base.js";

const SYSTEM_PROMPT = `You are an action interpreter for an ad operations platform called Switchboard.
Your job is to understand user intent and extract structured action proposals.

Available actions: {ACTIONS}

You must respond with ONLY a JSON object (no markdown, no explanation) in this exact format:
{
  "proposals": [
    {
      "id": "",
      "actionType": "<one of the available actions>",
      "parameters": { ... },
      "evidence": "<brief explanation>",
      "confidence": <0.0 to 1.0>,
      "originatingMessageId": ""
    }
  ],
  "needsClarification": false,
  "clarificationQuestion": null,
  "confidence": <0.0 to 1.0>
}

Rules:
- Only use action types from the available actions list
- Set confidence based on how certain you are about the user's intent
- If unclear, set needsClarification: true with a helpful question
- Extract all relevant parameters from the user message`;

export class ClaudeInterpreter extends LLMInterpreter {
  readonly name: string;

  constructor(config: LLMConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl ?? "https://api.anthropic.com",
    });
    this.name = `claude-${config.model.replace("claude-", "")}`;
  }

  protected async callLLM(prompt: string): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 1024,
        messages: [{ role: "user", content: prompt }],
        temperature: this.config.temperature ?? 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return {
      text,
      usage: data.usage
        ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens }
        : undefined,
    };
  }

  protected buildPrompt(
    text: string,
    _conversationContext: Record<string, unknown>,
    availableActions: string[],
  ): string {
    const system = SYSTEM_PROMPT.replace("{ACTIONS}", availableActions.join(", "));
    return `${system}\n\nUser message: ${text}`;
  }
}
