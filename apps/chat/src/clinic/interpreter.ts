import { LLMInterpreter } from "../interpreter/llm-base.js";
import type { LLMConfig, LLMResponse } from "../interpreter/llm-base.js";
import type { InterpreterResult } from "../interpreter/interpreter.js";
import { AllowedIntent } from "./types.js";
import type { ClassifyResult, ClinicContext } from "./types.js";
import type { ModelRouter } from "./model-router-types.js";
import {
  VALID_INTENTS,
  FALLBACK_PATTERNS,
  filterCampaignNames,
  buildClinicPrompt,
} from "./clinic-prompt.js";
import { mapClassifyToInterpreterOutput } from "./classify-mapper.js";

/** @deprecated Use SkinAwareInterpreter instead for new deployments. */
export class ClinicInterpreter extends LLMInterpreter {
  readonly name: string = "clinic-haiku";
  protected clinicContext: ClinicContext;
  protected modelRouter: ModelRouter | null;

  constructor(config: LLMConfig, clinicContext: ClinicContext, modelRouter?: ModelRouter) {
    super({
      ...config,
      model: config.model || "claude-3-5-haiku-20241022",
      maxTokens: config.maxTokens ?? 512,
      temperature: 0.0,
    });
    this.clinicContext = clinicContext;
    this.modelRouter = modelRouter ?? null;
  }

  /** Update campaign names for LLM grounding. Called by runtime on refresh. */
  updateCampaignNames(names: string[]): void {
    this.clinicContext.campaignNames = filterCampaignNames(names);
  }

  async interpret(
    text: string,
    conversationContext: Record<string, unknown>,
    availableActions: string[],
  ): Promise<InterpreterResult> {
    // Check model budget — fall back to regex if exceeded
    if (this.modelRouter && !(await this.modelRouter.shouldUseLLM())) {
      return this.fallbackInterpret(text, availableActions);
    }

    // Delegate to LLMInterpreter.interpret() which handles:
    // 1. Injection detection on input
    // 2. callLLM()
    // 3. Injection detection on output
    // 4. parseStructuredOutput()
    // 5. Schema guard
    // 6. Proposal tagging
    const result = await super.interpret(text, conversationContext, availableActions);

    // Record usage if model router is available
    if (this.modelRouter && result.rawResponse) {
      // Estimate tokens: ~4 chars per token for input, actual from response
      const estimatedInputTokens = Math.ceil(text.length / 4) + 200; // +200 for system prompt
      const estimatedOutputTokens = Math.ceil(result.rawResponse.length / 4);
      await this.modelRouter.recordUsage(estimatedInputTokens, estimatedOutputTokens);
    }

    return result;
  }

  protected async callLLM(prompt: string): Promise<LLMResponse> {
    if (this.config.baseUrl?.includes("openai")) {
      return this.callOpenAI(prompt);
    }
    return this.callAnthropic(prompt);
  }

  private async callAnthropic(prompt: string): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 512,
        messages: [{ role: "user", content: prompt }],
        temperature: this.config.temperature ?? 0.0,
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

  private async callOpenAI(prompt: string): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 512,
        messages: [{ role: "user", content: prompt }],
        temperature: this.config.temperature ?? 0.0,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      text,
      usage: data.usage
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
        : undefined,
    };
  }

  protected buildPrompt(
    text: string,
    conversationContext: Record<string, unknown>,
    _availableActions: string[],
  ): string {
    return buildClinicPrompt(
      text,
      conversationContext,
      this.clinicContext.campaignNames,
      this.clinicContext.adAccountId,
    );
  }

  protected parseStructuredOutput(rawText: string, availableActions: string[]): unknown {
    // Extract JSON from response
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) ?? rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM output");
    }
    const jsonStr = jsonMatch[1] ?? jsonMatch[0];
    const classify = JSON.parse(jsonStr) as ClassifyResult;

    // Validate intent is in our enum
    const intent = VALID_INTENTS.has(classify.intent as AllowedIntent)
      ? (classify.intent as AllowedIntent)
      : AllowedIntent.UNKNOWN;

    const confidence = typeof classify.confidence === "number" ? classify.confidence : 0;
    const slots = classify.slots && typeof classify.slots === "object" ? classify.slots : {};

    return mapClassifyToInterpreterOutput(
      intent,
      confidence,
      slots,
      availableActions,
      this.clinicContext.adAccountId,
    );
  }

  /** Regex-based fallback when LLM budget is exceeded. */
  protected fallbackInterpret(text: string, availableActions: string[]): InterpreterResult {
    for (const pattern of FALLBACK_PATTERNS) {
      const match = text.match(pattern.regex);
      if (match) {
        const slots = pattern.extractSlots(match);
        const output = mapClassifyToInterpreterOutput(
          pattern.intent,
          0.7,
          slots,
          availableActions,
          this.clinicContext.adAccountId,
        );
        return {
          ...(output as InterpreterResult),
          rawResponse: `[FALLBACK_REGEX] ${text}`,
        };
      }
    }

    return {
      proposals: [],
      needsClarification: true,
      clarificationQuestion:
        "I'm running in limited mode right now. Please try a specific command like:\n" +
        '- "pause [campaign name]"\n' +
        '- "set budget for [campaign] to $[amount]"\n' +
        '- "how are my campaigns doing?"',
      confidence: 0,
      rawResponse: `[FALLBACK_NO_MATCH] ${text}`,
    };
  }
}
