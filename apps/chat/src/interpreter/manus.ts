import { LLMInterpreter } from "./llm-base.js";
import type { LLMConfig, LLMResponse } from "./llm-base.js";

const SYSTEM_PROMPT = `You are Manus, an action interpreter for the Switchboard ad operations platform.
Parse user messages into structured action proposals.

Available actions: {ACTIONS}

Respond with JSON only:
{
  "proposals": [
    {
      "id": "",
      "actionType": "<action from available list>",
      "parameters": { ... },
      "evidence": "<reasoning>",
      "confidence": <0.0-1.0>,
      "originatingMessageId": ""
    }
  ],
  "needsClarification": <boolean>,
  "clarificationQuestion": <string|null>,
  "confidence": <0.0-1.0>
}`;

export class ManusInterpreter extends LLMInterpreter {
  readonly name = "manus";

  constructor(config: LLMConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl ?? "https://api.manus.ai/v1",
    });
  }

  protected async callLLM(prompt: string): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: "system", content: "You are Manus, a precise action interpreter." },
          { role: "user", content: prompt },
        ],
        max_tokens: this.config.maxTokens ?? 1024,
        temperature: this.config.temperature ?? 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Manus API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      text: data.choices[0]?.message.content ?? "",
      usage: data.usage
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
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
