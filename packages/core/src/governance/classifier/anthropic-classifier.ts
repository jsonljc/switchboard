import type Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";
import {
  ClassifierSentenceResultSchema,
  CLASSIFIER_SCHEMA_VERSION,
  type ClaimType,
  type ClassifierSentenceResult,
} from "@switchboard/schemas";
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_PROMPT_VERSION,
  CLASSIFIER_PROMPT_HASH,
} from "./prompt.js";
import { recordLlmCacheEffectiveness } from "../../telemetry/metrics.js";

export interface ClassifierCallResult {
  result: ClassifierSentenceResult;
  promptVersion: string;
  promptHash: string;
  schemaVersion: string;
  model: string;
}

export interface AnthropicClaimClassifier {
  classify(input: {
    sentence: string;
    model: string;
    signal: AbortSignal;
  }): Promise<ClassifierCallResult>;
}

const CLASSIFIER_TOOL: Tool = {
  name: "classify_claim",
  description: "Classify a single sentence into one regulatory claim type.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      claimType: {
        type: "string",
        enum: [
          "efficacy",
          "safety-claim",
          "superiority",
          "urgency",
          "testimonial",
          "medical-advice",
          "diagnosis",
          "credentials",
          "none",
        ],
      },
      confidence: { type: "number" },
    },
    required: ["claimType", "confidence"],
  },
};

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: { claimType: ClaimType; confidence: number };
}

export function createAnthropicClaimClassifier(client: Anthropic): AnthropicClaimClassifier {
  return {
    async classify({ sentence, model, signal }): Promise<ClassifierCallResult> {
      const response = await client.messages.create(
        {
          model,
          max_tokens: 256,
          system: [
            {
              type: "text",
              text: CLASSIFIER_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: [
            {
              ...CLASSIFIER_TOOL,
              cache_control: { type: "ephemeral" },
            },
          ],
          tool_choice: { type: "tool", name: "classify_claim" },
          messages: [{ role: "user", content: sentence }],
        },
        { signal },
      );

      // Per-call prompt-cache effectiveness (hit/populate/miss + zero-read warn).
      // The classifier caches its system prompt + tool definition; recording per
      // call surfaces a silent cache bust (e.g. a prompt-version change) the same
      // way the non-governance call sites do (S1). Side-effect only: it changes
      // neither the request nor the classification result. Sampling params stay
      // omitted, so this call is already forward-compatible with 4.7+ ids and
      // needs no per-id guard (unlike the other non-governance call sites).
      recordLlmCacheEffectiveness({
        model,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      });

      const blocks = (response as { content?: ReadonlyArray<unknown> }).content ?? [];
      const toolUse = blocks.find(
        (b): b is ToolUseBlock =>
          typeof b === "object" &&
          b !== null &&
          (b as { type?: string }).type === "tool_use" &&
          (b as { name?: string }).name === "classify_claim",
      );
      if (!toolUse) {
        throw new Error("Classifier response missing classify_claim tool use");
      }

      const parsed = ClassifierSentenceResultSchema.parse({
        sentence,
        claimType: toolUse.input.claimType,
        confidence: toolUse.input.confidence,
      });

      return {
        result: parsed,
        promptVersion: CLASSIFIER_PROMPT_VERSION,
        promptHash: CLASSIFIER_PROMPT_HASH,
        schemaVersion: CLASSIFIER_SCHEMA_VERSION,
        model,
      };
    },
  };
}
