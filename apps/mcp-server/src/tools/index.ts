import { sideEffectToolDefinitions, SIDE_EFFECT_ACTION_TYPE_MAP } from "./side-effect.js";
import { readToolDefinitions } from "./read.js";
import { governanceToolDefinitions } from "./governance.js";
import {
  crmToolDefinitions,
  CRM_SIDE_EFFECT_TOOLS,
  CRM_READ_TOOLS,
  CRM_ACTION_TYPE_MAP,
} from "./crm.js";
import {
  paymentsToolDefinitions,
  PAYMENTS_SIDE_EFFECT_TOOLS,
  PAYMENTS_READ_TOOLS,
  PAYMENTS_ACTION_TYPE_MAP,
} from "./payments.js";
import type { ToolDefinition } from "./side-effect.js";

export type { ToolDefinition };

/** All MCP tool definitions for tools/list. */
export const toolDefinitions: ToolDefinition[] = [
  ...sideEffectToolDefinitions,
  ...readToolDefinitions,
  ...governanceToolDefinitions,
  ...crmToolDefinitions,
  ...paymentsToolDefinitions,
];

/** Set of side-effect tool names for dispatch routing. */
export const SIDE_EFFECT_TOOLS = new Set([
  ...sideEffectToolDefinitions.map((t) => t.name),
  ...CRM_SIDE_EFFECT_TOOLS,
  ...PAYMENTS_SIDE_EFFECT_TOOLS,
]);

/** Set of read-only tool names for dispatch routing. */
export const READ_TOOLS = new Set([
  ...readToolDefinitions.map((t) => t.name),
  ...CRM_READ_TOOLS,
  ...PAYMENTS_READ_TOOLS,
]);

/** Set of governance tool names for dispatch routing. */
export const GOVERNANCE_TOOLS = new Set(governanceToolDefinitions.map((t) => t.name));

/**
 * All actionTypes already covered by manual tool definitions.
 * Used by auto-register to skip generating duplicates.
 */
export const MANUAL_ACTION_TYPES = new Set([
  ...Object.values(SIDE_EFFECT_ACTION_TYPE_MAP),
  ...Object.values(CRM_ACTION_TYPE_MAP),
  ...Object.values(PAYMENTS_ACTION_TYPE_MAP),
]);

export { handleSideEffectTool } from "./side-effect.js";
export { handleReadTool } from "./read.js";
export type { ReadToolDeps } from "./read.js";
export { handleGovernanceTool } from "./governance.js";
export type { GovernanceToolDeps } from "./governance.js";
export { handleCrmSideEffectTool, handleCrmReadTool } from "./crm.js";
export { handlePaymentsSideEffectTool, handlePaymentsReadTool } from "./payments.js";
