import type { CartridgeManifest } from "@switchboard/schemas";
import type { RegisteredTool, ToolFilter } from "./types.js";
import { matchesAny } from "./filter.js";

export type { RegisteredTool, ToolFilter } from "./types.js";
export { matchGlob, matchesAny } from "./filter.js";

/**
 * ToolRegistry manages the set of available tools (cartridge actions)
 * and supports filtering by skin configuration.
 *
 * Usage:
 *   const registry = new ToolRegistry();
 *   registry.registerCartridge("crm", crmManifest);
 *   registry.registerCartridge("patient-engagement", peManifest);
 *
 *   // Apply skin filter
 *   const filtered = registry.getFilteredTools({
 *     include: ["patient-engagement.*"],
 *     exclude: ["patient-engagement.internal.*"],
 *   });
 */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private cartridges = new Map<string, CartridgeManifest>();
  private duplicateActionTypes = new Set<string>();

  /**
   * Register all actions from a cartridge manifest.
   */
  registerCartridge(cartridgeId: string, manifest: CartridgeManifest): void {
    this.cartridges.set(cartridgeId, manifest);
    if (manifest.actions) {
      for (const action of manifest.actions) {
        const existing = this.tools.get(action.actionType);
        if (existing && existing.cartridgeId !== cartridgeId) {
          // Track duplicates — keep the latest registration
          this.duplicateActionTypes.add(action.actionType);
        }
        this.tools.set(action.actionType, {
          actionType: action.actionType,
          cartridgeId,
          definition: action,
        });
      }
    }
  }

  /**
   * Unregister all actions from a cartridge.
   */
  unregisterCartridge(cartridgeId: string): void {
    this.cartridges.delete(cartridgeId);
    for (const [actionType, tool] of this.tools) {
      if (tool.cartridgeId === cartridgeId) {
        this.tools.delete(actionType);
      }
    }
  }

  /**
   * Get all registered tools (unfiltered).
   */
  getAllTools(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  /**
   * Get a tool by its action type.
   */
  getTool(actionType: string): RegisteredTool | undefined {
    return this.tools.get(actionType);
  }

  /**
   * Get tools filtered by a ToolFilter (include/exclude/aliases).
   * Returns only tools that match at least one include pattern
   * and don't match any exclude pattern.
   */
  getFilteredTools(filter: ToolFilter): RegisteredTool[] {
    const result: RegisteredTool[] = [];

    for (const tool of this.tools.values()) {
      // Must match at least one include pattern
      if (!matchesAny(tool.actionType, filter.include)) {
        continue;
      }

      // Must not match any exclude pattern
      if (filter.exclude && matchesAny(tool.actionType, filter.exclude)) {
        continue;
      }

      // Check if there's an alias for this action type
      let alias: string | undefined;
      if (filter.aliases) {
        for (const [aliasName, canonicalType] of Object.entries(filter.aliases)) {
          if (canonicalType === tool.actionType) {
            alias = aliasName;
            break;
          }
        }
      }

      result.push(alias ? { ...tool, alias } : tool);
    }

    return result;
  }

  /**
   * Resolve an action type or alias to its canonical action type.
   * Checks aliases first, then falls back to the literal action type.
   */
  resolveActionType(input: string, filter?: ToolFilter): string | null {
    // Check aliases first
    if (filter?.aliases) {
      const canonical = filter.aliases[input];
      if (canonical && this.tools.has(canonical)) {
        return canonical;
      }
    }

    // Fall back to literal match
    if (this.tools.has(input)) {
      return input;
    }

    return null;
  }

  /**
   * Get all registered cartridge IDs.
   */
  getCartridgeIds(): string[] {
    return [...this.cartridges.keys()];
  }

  /**
   * Check if a specific action type is registered.
   */
  has(actionType: string): boolean {
    return this.tools.has(actionType);
  }

  /**
   * Get the total number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Validate that all action types in a list are unique across cartridges.
   * Returns duplicate action types (if any).
   */
  findDuplicates(): string[] {
    return [...this.duplicateActionTypes];
  }
}
