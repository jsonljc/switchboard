// packages/core/src/creative-pipeline/stages/call-claude.ts
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";
const DEFAULT_MAX_TOKENS = 4096;

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
 * Call Claude with a system prompt and user message, parse the response
 * as JSON, and validate against a Zod schema.
 */
export async function callClaude<T extends z.ZodType>(
  options: CallClaudeOptions<T>,
): Promise<z.infer<T>> {
  const client = new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: options.systemPrompt,
    messages: [{ role: "user", content: options.userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
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
    return options.schema.parse(parsed);
  } catch (err) {
    const snippet = jsonStr.length > 200 ? jsonStr.slice(0, 200) + "..." : jsonStr;
    throw new Error(
      `Claude response failed schema validation. Raw JSON: ${snippet}\n${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
