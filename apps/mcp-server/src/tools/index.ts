import { sideEffectToolDefinitions } from "./side-effect.js";
import { readToolDefinitions } from "./read.js";
import type { ToolDefinition } from "./side-effect.js";

export type { ToolDefinition };

/** All 10 MCP tool definitions for tools/list. */
export const toolDefinitions: ToolDefinition[] = [
  ...sideEffectToolDefinitions,
  ...readToolDefinitions,
];

/** Set of side-effect tool names for dispatch routing. */
export const SIDE_EFFECT_TOOLS = new Set(
  sideEffectToolDefinitions.map((t) => t.name),
);

/** Set of read-only tool names for dispatch routing. */
export const READ_TOOLS = new Set(
  readToolDefinitions.map((t) => t.name),
);

export { handleSideEffectTool } from "./side-effect.js";
export { handleReadTool } from "./read.js";
export type { ReadToolDeps } from "./read.js";
