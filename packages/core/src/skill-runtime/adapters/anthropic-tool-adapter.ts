import type Anthropic from "@anthropic-ai/sdk";
import {
  LLMAdapterShapeMismatchError,
  type ToolCallingLLMAdapter,
  type LLMMessage,
  type LLMToolDefinition,
  type LLMResponse,
  type LLMContentBlock,
  type LLMStopReason,
  type LLMToolResultBlock,
} from "../llm-types.js";

// encodeToolName / decodeToolName are the sole "." ↔ "__" boundary for both
// tool definitions and outgoing message history (tool_use blocks).
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const PROVIDER = "anthropic";

// Anthropic tool names must match ^[a-zA-Z0-9_-]{1,128}$. Internally the
// skill-executor uses "<toolId>.<opName>" (e.g. "crm-query.contact.get") with
// "." as the separator — it splits on the first "." to recover toolId + op.
// We encode at the API boundary by replacing "." with "__". This is safe
// because current toolIds are kebab-case and opNames use dot-separated words,
// so neither part ever contains "__" natively. If that assumption changes,
// introduce a more collision-proof scheme before relaxing this guard.

// Anthropic tool names must match this exactly (name field on tool definitions
// AND on tool_use blocks in message history).
const ANTHROPIC_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Throw if an ENCODED tool name would be rejected by the Anthropic API. Call
 * this on the post-encoding result so future naming drift (a tool id/op with an
 * API-illegal character, or a name >128 chars) fails loudly in tests/at boot
 * rather than as a live 400 mid-conversation.
 */
function assertValidAnthropicToolName(encoded: string): void {
  if (!ANTHROPIC_TOOL_NAME_RE.test(encoded)) {
    throw new Error(
      `[AnthropicToolAdapter] encoded tool name "${encoded}" violates Anthropic's ` +
        `^[a-zA-Z0-9_-]{1,128}$ pattern. Tool ids/operations must encode to that ` +
        `charset; fix the source name or the encoding scheme before relaxing this guard.`,
    );
  }
}

/**
 * Encode an internal dotted tool name to an Anthropic-API-safe form.
 * "crm-query.contact.get" → "crm-query__contact__get"
 */
export function encodeToolName(name: string): string {
  if (name.includes("__")) {
    // Guard: source names must not already contain the separator token.
    // Violating this would make decode() ambiguous. Throw early so the
    // mismatch is obvious in tests, not silently wrong in production.
    throw new Error(
      `[AnthropicToolAdapter] encodeToolName: source tool name "${name}" already contains "__". Choose a different separator or pre-sanitize the name.`,
    );
  }
  const encoded = name.replace(/\./g, "__");
  assertValidAnthropicToolName(encoded);
  return encoded;
}

/**
 * Decode an Anthropic-API-safe tool name back to internal dotted form.
 * "crm-query__contact__get" → "crm-query.contact.get"
 */
export function decodeToolName(name: string): string {
  return name.replace(/__/g, ".");
}

const KNOWN_STOP_REASONS: ReadonlySet<LLMStopReason> = new Set([
  "end_turn",
  "tool_use",
  "max_tokens",
]);

/**
 * Map a provider-neutral message's content to the Anthropic wire shape, encoding
 * tool_use names ("."→"__") so multi-turn history satisfies the API tool-name
 * pattern. Outgoing content is constructed by our executor (decoded blocks),
 * so non-tool_use blocks (text, tool_result) pass through unchanged.
 */
function encodeOutgoingContent(content: LLMMessage["content"]): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  // Exhaustive block handling: encode tool_use names; pass text/tool_result
  // through; THROW on any unknown block so a future shape can't silently bypass
  // encoding (mirrors the response-side LLMAdapterShapeMismatchError discipline).
  // The typed assignment widens the union-of-arrays to an array-of-union so that
  // .map() is callable; the real guard is the exhaustive if-chain below.
  const blocks: Array<LLMContentBlock | LLMToolResultBlock> = content;
  return blocks.map((block) => {
    if (block.type === "tool_use") {
      return { ...block, name: encodeToolName(block.name) };
    }
    if (block.type === "text" || block.type === "tool_result") {
      return block;
    }
    throw new Error(
      `[AnthropicToolAdapter] unsupported outgoing content block: ${JSON.stringify(block)}`,
    );
  }) as Anthropic.MessageParam["content"];
}

export class AnthropicToolAdapter implements ToolCallingLLMAdapter {
  constructor(private client: Anthropic) {}

  async chatWithTools(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDefinition[];
    maxTokens?: number;
    profile?: { model: string; maxTokens: number; temperature: number; timeoutMs: number };
  }): Promise<LLMResponse> {
    const anthropicMessages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role,
      content: encodeOutgoingContent(m.content),
    }));

    const anthropicTools: Anthropic.Tool[] | undefined =
      params.tools.length > 0
        ? params.tools.map((t) => ({
            name: encodeToolName(t.name), // encode "." → "__" so the name satisfies ^[a-zA-Z0-9_-]{1,128}$
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          }))
        : undefined;

    const response = await this.client.messages.create({
      model: params.profile?.model ?? DEFAULT_MODEL,
      max_tokens: params.profile?.maxTokens ?? params.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: params.system,
      messages: anthropicMessages,
      tools: anthropicTools,
      ...(params.profile?.temperature !== undefined && {
        temperature: params.profile.temperature,
      }),
    });

    // Translate content blocks. Unknown block types MUST surface as a typed
    // adapter error — silent coercion to empty text hides provider mismatches.
    const content: LLMContentBlock[] = response.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: decodeToolName(block.name), // decode "__" → "." so executor's name.split(".") parsing works
          input: block.input,
        };
      }
      throw new LLMAdapterShapeMismatchError(PROVIDER, "content_block", String(block.type));
    });

    // Translate stop_reason. Unknown reasons MUST surface — Anthropic adds
    // new ones (`refusal`, `pause_turn`, etc.) and silent coercion to "end_turn"
    // would hide premature stops.
    if (!KNOWN_STOP_REASONS.has(response.stop_reason as LLMStopReason)) {
      throw new LLMAdapterShapeMismatchError(PROVIDER, "stop_reason", String(response.stop_reason));
    }

    return {
      content,
      stopReason: response.stop_reason as LLMStopReason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
