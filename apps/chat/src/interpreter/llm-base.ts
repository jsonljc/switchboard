import { randomUUID } from "node:crypto";
import type { Interpreter, InterpreterResult } from "./interpreter.js";
import { guardInterpreterOutput } from "./schema-guard.js";
import { detectPromptInjection, detectPromptInjectionInOutput } from "./injection-detector.js";
import type { ReadIntentDescriptor } from "../clinic/types.js";

export interface LLMConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
}

export interface LLMResponse {
  text: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Base class for LLM-backed interpreters.
 * Subclasses implement callLLM() and buildPrompt().
 * The base class handles:
 *  - Prompt injection detection on user input
 *  - LLM API call
 *  - Prompt injection detection on LLM output
 *  - Structured output parsing
 *  - Schema guard validation
 */
export abstract class LLMInterpreter implements Interpreter {
  abstract readonly name: string;
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async interpret(
    text: string,
    conversationContext: Record<string, unknown>,
    availableActions: string[],
  ): Promise<InterpreterResult> {
    // 1. Check user input for prompt injection
    const inputCheck = detectPromptInjection(text);
    if (inputCheck.detected) {
      console.warn(
        `[${this.name}] Prompt injection detected in user input: ${inputCheck.patterns.join(", ")}`,
      );
      return {
        proposals: [],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 0,
        rawResponse: `[INJECTION_BLOCKED] Patterns: ${inputCheck.patterns.join(", ")}`,
      };
    }

    // 2. Build prompt and call LLM
    const prompt = this.buildPrompt(text, conversationContext, availableActions);
    let llmResponse: LLMResponse;
    try {
      llmResponse = await this.callLLM(prompt);
    } catch (err) {
      console.error(`[${this.name}] LLM API call failed:`, err);
      return {
        proposals: [],
        needsClarification: true,
        clarificationQuestion: "I'm having trouble processing your request right now. Could you try again?",
        confidence: 0,
        rawResponse: `[LLM_ERROR] ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 3. Check LLM output for prompt injection
    const outputCheck = detectPromptInjectionInOutput(llmResponse.text);
    if (outputCheck.detected) {
      console.warn(
        `[${this.name}] Prompt injection detected in LLM output: ${outputCheck.patterns.join(", ")}`,
      );
      return {
        proposals: [],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 0,
        rawResponse: `[OUTPUT_INJECTION_BLOCKED] Patterns: ${outputCheck.patterns.join(", ")}`,
      };
    }

    // 4. Parse structured output
    let parsed: unknown;
    try {
      parsed = this.parseStructuredOutput(llmResponse.text, availableActions);
    } catch (err) {
      console.error(`[${this.name}] Failed to parse structured output:`, err);
      return {
        proposals: [],
        needsClarification: true,
        clarificationQuestion: "I couldn't understand the response format. Could you rephrase?",
        confidence: 0,
        rawResponse: llmResponse.text,
      };
    }

    // 5. Schema guard validation
    const guard = guardInterpreterOutput(parsed);
    if (!guard.valid || !guard.data) {
      console.error(`[${this.name}] Schema guard rejected output:`, guard.errors);
      return {
        proposals: [],
        needsClarification: true,
        clarificationQuestion: "I had trouble interpreting that. Could you try rephrasing?",
        confidence: 0,
        rawResponse: llmResponse.text,
      };
    }

    // 6. Tag proposals with interpreter name
    const taggedProposals = guard.data.proposals.map((p) => ({
      ...p,
      id: p.id || `prop_${randomUUID()}`,
      interpreterName: this.name,
    }));

    return {
      proposals: taggedProposals,
      needsClarification: guard.data.needsClarification,
      clarificationQuestion: guard.data.clarificationQuestion,
      confidence: guard.data.confidence,
      rawResponse: llmResponse.text,
      readIntent: guard.data.readIntent as ReadIntentDescriptor | null | undefined ?? undefined,
    };
  }

  protected abstract callLLM(prompt: string): Promise<LLMResponse>;

  protected abstract buildPrompt(
    text: string,
    conversationContext: Record<string, unknown>,
    availableActions: string[],
  ): string;

  protected parseStructuredOutput(
    rawText: string,
    _availableActions: string[],
  ): unknown {
    // Default: extract JSON from the response
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) ??
      rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM output");
    }
    const jsonStr = jsonMatch[1] ?? jsonMatch[0];
    return JSON.parse(jsonStr);
  }
}
