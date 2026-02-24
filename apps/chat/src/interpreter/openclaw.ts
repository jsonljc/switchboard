import { LLMInterpreter } from "./llm-base.js";
import type { LLMConfig, LLMResponse } from "./llm-base.js";

const SYSTEM_PROMPT = `You are an action interpreter for an ad operations platform.
Given a user message, extract the intended action as structured JSON.

Important: Your output is structured data that feeds into a governance pipeline. You do not execute actions directly. All proposals are subject to policy evaluation, risk scoring, and approval requirements before any action is taken.

Available actions: {ACTIONS}

Respond ONLY with a JSON object in this format:
\`\`\`json
{
  "proposals": [
    {
      "id": "",
      "actionType": "<one of the available actions>",
      "parameters": { ... },
      "evidence": "<brief explanation of why you chose this action>",
      "confidence": <0.0 to 1.0>,
      "originatingMessageId": ""
    }
  ],
  "needsClarification": false,
  "clarificationQuestion": null,
  "confidence": <0.0 to 1.0>
}
\`\`\`

If the user's intent is unclear, set needsClarification to true and provide a clarificationQuestion.
If no action matches, return an empty proposals array with needsClarification true.`;

export class OpenClawInterpreter extends LLMInterpreter {
  readonly name = "openclaw";

  constructor(config: LLMConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl ?? "https://api.openclaw.ai/v1",
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
        messages: [{ role: "user", content: prompt }],
        max_tokens: this.config.maxTokens ?? 1024,
        temperature: this.config.temperature ?? 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenClaw API error: ${response.status} ${response.statusText}`);
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
