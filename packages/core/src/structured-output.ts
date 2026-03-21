import type { ZodSchema } from "zod";

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; raw: string };

export function parseStructuredOutput<T>(raw: string, schema: ZodSchema<T>): ParseResult<T> {
  // Try to extract JSON from markdown code block
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]!.trim() : raw.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { success: false, error: "Invalid JSON", raw };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues.map((i) => i.message).join("; "),
      raw,
    };
  }

  return { success: true, data: result.data };
}
