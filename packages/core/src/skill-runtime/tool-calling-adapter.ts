// Backward-compatibility re-exports. New code should import from
// llm-types.ts (provider-neutral) or adapters/anthropic-tool-adapter.ts.

export type { ToolCallingLLMAdapter as ToolCallingAdapter } from "./llm-types.js";
export type { LLMResponse as ToolCallingAdapterResponse } from "./llm-types.js";
export { AnthropicToolAdapter as AnthropicToolCallingAdapter } from "./adapters/anthropic-tool-adapter.js";
