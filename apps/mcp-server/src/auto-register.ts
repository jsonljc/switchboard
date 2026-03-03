import type { CartridgeRegistry } from "@switchboard/core";
import type { ActionDefinition } from "@switchboard/schemas";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDefinition } from "./tools/side-effect.js";
import type { ToolFilter } from "@switchboard/core";
import { matchesAny } from "@switchboard/core";

export interface AutoRegisteredTool extends ToolDefinition {
  actionType: string;
  cartridgeId: string;
  annotations: ToolAnnotations;
}

/**
 * Auto-generate MCP tool definitions from the cartridge registry.
 *
 * Skips any actionTypes already covered by manual tools (provided in
 * `manualActionTypes`). Derives tool annotations from the manifest's
 * `baseRiskCategory`.
 *
 * When a `toolFilter` is provided (from a skin), only actions matching the
 * filter's include/exclude patterns are exposed.
 */
export function generateToolsFromRegistry(
  registry: CartridgeRegistry,
  manualActionTypes: Set<string>,
  toolFilter?: ToolFilter,
): AutoRegisteredTool[] {
  const tools: AutoRegisteredTool[] = [];

  for (const cartridgeId of registry.list()) {
    const cartridge = registry.get(cartridgeId);
    if (!cartridge) continue;

    const actions: ActionDefinition[] = cartridge.manifest.actions;

    for (const action of actions) {
      if (manualActionTypes.has(action.actionType)) continue;

      // When a skin filter is active, skip actions not matching include/exclude patterns
      if (toolFilter) {
        if (!matchesAny(action.actionType, toolFilter.include)) continue;
        if (toolFilter.exclude && matchesAny(action.actionType, toolFilter.exclude)) continue;
      }

      const toolName = action.actionType.replace(/[.-]/g, "_");
      const inputSchema = normalizeSchema(action.parametersSchema);
      const annotations = deriveAnnotations(action);

      tools.push({
        name: toolName,
        description: action.description,
        inputSchema,
        actionType: action.actionType,
        cartridgeId,
        annotations,
      });
    }
  }

  return tools;
}

/**
 * Normalize the parametersSchema from a cartridge action definition.
 *
 * Patient-engagement and quant-trading use a flat format where the schema
 * is `{ paramName: { type: "string" }, ... }` rather than a full JSON Schema
 * with `type: "object"` wrapper. We detect this and wrap it.
 */
function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema["type"] === "object" && schema["properties"]) {
    return schema;
  }

  // Flat format: each key is a property definition
  return {
    type: "object",
    properties: schema,
  };
}

/**
 * Derive MCP ToolAnnotations from an ActionDefinition.
 */
function deriveAnnotations(action: ActionDefinition): ToolAnnotations {
  const isHighRisk = action.baseRiskCategory === "high" || action.baseRiskCategory === "critical";

  return {
    readOnlyHint: false,
    destructiveHint: isHighRisk,
    idempotentHint: false,
    openWorldHint: true,
  };
}
