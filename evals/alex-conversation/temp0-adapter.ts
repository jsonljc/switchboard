import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicToolAdapter } from "@switchboard/core/skill-runtime";

/**
 * The parameter / return shapes of the inner adapter's `chatWithTools`.
 *
 * `ToolCallingLLMAdapter`, `LLMMessage`, `LLMToolDefinition`, and `LLMResponse`
 * are NOT re-exported from `@switchboard/core/skill-runtime`, so we derive the
 * shapes structurally from the exported `AnthropicToolAdapter` class. An object
 * exposing a single `chatWithTools(params): Promise<LLMResponse>` method is
 * structurally assignable to `ToolCallingLLMAdapter` (the interface declares
 * exactly that one method), so the return value drops straight into
 * `new SkillExecutorImpl(adapter, ...)` without importing the private type.
 */
type ChatWithToolsFn = AnthropicToolAdapter["chatWithTools"];
type ChatWithToolsParams = Parameters<ChatWithToolsFn>[0];
type ChatWithToolsResult = ReturnType<ChatWithToolsFn>;

/**
 * The minimal structural shape the skill executor needs: a single
 * `chatWithTools` method. Matches `ToolCallingLLMAdapter` by structure.
 */
export interface Temp0Adapter {
  chatWithTools(params: ChatWithToolsParams): ChatWithToolsResult;
}

/**
 * Wraps an inner tool-calling adapter (optionally constructed from a real
 * `Anthropic` client) and FORCES `temperature: 0` on every call.
 *
 * WHY this wrapper is necessary: `SkillExecutorImpl` only sends a `temperature`
 * when it passes a `profile` to `chatWithTools` — and it only builds a profile
 * when a `ModelRouter` is wired (see skill-executor.ts `resolveProfile`). The
 * eval harness runs the executor with NO router, so the executor's `profile` is
 * `undefined` and `AnthropicToolAdapter.chatWithTools` would omit `temperature`
 * entirely (defaulting to provider sampling). For deterministic grading we must
 * pin `temperature: 0`. This wrapper synthesizes a `profile` carrying the model,
 * maxTokens, `temperature: 0`, and a timeout on every call — overriding whatever
 * profile (if any) the executor passes.
 */
export function createTemp0Adapter(
  client: Anthropic,
  model: string,
  maxTokens: number,
  timeoutMs = 60_000,
): Temp0Adapter {
  const inner = new AnthropicToolAdapter(client);
  return createTemp0AdapterFromInner(inner, model, maxTokens, timeoutMs);
}

/**
 * Same as {@link createTemp0Adapter} but takes an already-constructed inner
 * adapter. Exposed for tests that inject a spy in place of the real
 * `AnthropicToolAdapter` to assert the forced `temperature: 0` profile without
 * touching the network.
 */
export function createTemp0AdapterFromInner(
  inner: Temp0Adapter,
  model: string,
  maxTokens: number,
  timeoutMs = 60_000,
): Temp0Adapter {
  return {
    chatWithTools(params: ChatWithToolsParams): ChatWithToolsResult {
      return inner.chatWithTools({
        ...params,
        // Override any executor-supplied profile — temperature:0 is the point.
        profile: { model, maxTokens, temperature: 0, timeoutMs },
      });
    },
  };
}
