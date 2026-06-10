// packages/creative-pipeline/src/stages/call-claude.ts
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/**
 * Anthropic model ids this pipeline is known to run against. This is the single
 * deliberately-maintained source of truth: DEFAULT_MODEL MUST be a member, and
 * call-claude.test.ts pins both so changing one without the other fails CI.
 *
 * The list exists because the original default "claude-sonnet-4-5-20250514"
 * (it mixes Sonnet 4.5's name with Sonnet 4's date suffix) is not a real
 * model id and 404'd every live call, yet shipped unnoticed because every test
 * mocks the SDK (2026-06-10 Mira capability audit, D1-F1). Update this list (and
 * the test) deliberately when migrating models; verify ids against the real
 * Anthropic catalog, never from memory.
 */
export const KNOWN_GOOD_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-haiku-4-5",
] as const;

export type KnownGoodModel = (typeof KNOWN_GOOD_MODELS)[number];

/**
 * Default model for the creative pipeline. Cost-sensitive content generation →
 * current-generation Sonnet (the faithful successor to the Sonnet-4.5 tier the
 * original code intended). Centralized here: callers that pass no `model` fall
 * back to this, and apps/api threads an optional override in via LLMConfig.
 */
export const DEFAULT_MODEL: KnownGoodModel = "claude-sonnet-4-6";

const DEFAULT_MAX_TOKENS = 4096;

// Anthropic ids are lowercase, dash-delimited (e.g. "claude-sonnet-4-6",
// "claude-opus-4-8-20260106"). Dots ("claude-sonnet-4.6"), spaces, uppercase,
// and non-claude providers are rejected; these are the common typo / wrong-key
// shapes that otherwise surface only as an opaque 404 mid-job.
const MODEL_ID_SHAPE = /^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Reject obviously malformed model ids at the call seam, so a bad id (a typo, an
 * empty env value, a non-Anthropic key) fails loudly here instead of as a
 * confusing HTTP 404 from the Messages API after a creative job has started.
 *
 * Note: this is a SHAPE guard, not an allowlist. Explicit overrides may use any
 * well-formed claude id so newer models don't require a code change. The default
 * is pinned to KNOWN_GOOD_MODELS separately (see the co-located test).
 */
export function assertValidModelId(model: string): void {
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error("creative-pipeline: model id must be a non-empty string");
  }
  if (!MODEL_ID_SHAPE.test(model)) {
    throw new Error(
      `creative-pipeline: "${model}" is not a valid Anthropic model id ` +
        `(expected a lowercase dash-delimited id like "${DEFAULT_MODEL}")`,
    );
  }
}

export interface CallClaudeOptions<T extends z.ZodType> {
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  schema: T;
  model?: string;
  maxTokens?: number;
}

/**
 * Extract a JSON object from Claude's text response.
 * Handles: raw JSON, ```json fenced blocks, JSON embedded in prose.
 */
export function extractJson(text: string): string {
  // Try markdown code fence first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Try raw JSON object (greedy match from first { to last })
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  throw new Error("No JSON object found in response");
}

/**
 * Shared response tail: find the text block, extract + parse JSON, validate
 * against the schema. One implementation so the text-only and image-block
 * variants cannot drift.
 */
function parseClaudeResponse<T extends z.ZodType>(
  response: { content: Array<{ type: string; text?: string }> },
  schema: T,
): z.infer<T> {
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text" || textBlock.text === undefined) {
    throw new Error("Empty response from Claude");
  }

  const jsonStr = extractJson(textBlock.text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const snippet = jsonStr.length > 200 ? jsonStr.slice(0, 200) + "..." : jsonStr;
    throw new Error(`Failed to parse JSON from Claude response: ${snippet}`);
  }

  try {
    return schema.parse(parsed);
  } catch (err) {
    const snippet = jsonStr.length > 200 ? jsonStr.slice(0, 200) + "..." : jsonStr;
    throw new Error(
      `Claude response failed schema validation. Raw JSON: ${snippet}\n${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Call Claude with a system prompt and user message, parse the response
 * as JSON, and validate against a Zod schema.
 */
export async function callClaude<T extends z.ZodType>(
  options: CallClaudeOptions<T>,
): Promise<z.infer<T>> {
  const model = options.model ?? DEFAULT_MODEL;
  assertValidModelId(model);

  const client = new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: options.systemPrompt,
    messages: [{ role: "user", content: options.userMessage }],
  });

  return parseClaudeResponse(response, options.schema);
}

export interface CallClaudeWithImagesOptions<T extends z.ZodType> extends CallClaudeOptions<T> {
  /** Base64 JPEG frames, in chronological order; sent before the text block. */
  images: string[];
}

/**
 * Image-block variant for frame-QA (slice-3 spec 3.1): frames go to the model
 * as base64 image content blocks followed by the text instruction. Same
 * extractJson + zod-parse tail as the text-only call.
 */
export async function callClaudeWithImages<T extends z.ZodType>(
  options: CallClaudeWithImagesOptions<T>,
): Promise<z.infer<T>> {
  const model = options.model ?? DEFAULT_MODEL;
  assertValidModelId(model);

  const client = new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: options.systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          ...options.images.map((data) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/jpeg" as const,
              data,
            },
          })),
          { type: "text" as const, text: options.userMessage },
        ],
      },
    ],
  });

  return parseClaudeResponse(response, options.schema);
}
