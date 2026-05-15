// Provider-neutral types for the tool-calling adapter boundary.
// No provider SDK types may appear in this file.

export interface LLMTextBlock {
  type: "text";
  text: string;
}

export interface LLMToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export type LLMContentBlock = LLMTextBlock | LLMToolUseBlock;

export interface LLMToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type LLMMessageRole = "user" | "assistant";

export interface LLMMessage {
  role: LLMMessageRole;
  content: string | LLMContentBlock[] | LLMToolResultBlock[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type LLMStopReason = "end_turn" | "tool_use" | "max_tokens";

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: LLMContentBlock[];
  stopReason: LLMStopReason;
  usage: LLMUsage;
}

export interface LLMError {
  retryable: boolean;
  statusCode?: number;
  message: string;
  provider: string;
}

// LLMError is consumed by PR-4B's fallback router. PR-4 only defines the
// shape and proves the boundary; no runtime path consumes `retryable` yet.
export function isRetryableError(err: unknown): err is LLMError {
  return (
    typeof err === "object" &&
    err !== null &&
    "retryable" in err &&
    (err as LLMError).retryable === true
  );
}

// Thrown by adapter implementations when the provider returns a shape the
// adapter cannot translate (unknown stop reason, unknown content block type,
// etc). Surfaces the mismatch at the boundary instead of silently coercing.
export class LLMAdapterShapeMismatchError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: "stop_reason" | "content_block",
    public readonly observed: string,
  ) {
    super(`[${provider}] unknown ${kind}: ${observed}`);
    this.name = "LLMAdapterShapeMismatchError";
  }
}

export interface ToolCallingLLMAdapter {
  chatWithTools(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDefinition[];
    maxTokens?: number;
    profile?: { model: string; maxTokens: number; temperature: number; timeoutMs: number };
  }): Promise<LLMResponse>;
}
