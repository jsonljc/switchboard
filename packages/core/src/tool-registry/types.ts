import type { ActionDefinition } from "@switchboard/schemas";

/** A registered tool with its source cartridge and action definition. */
export interface RegisteredTool {
  /** Fully qualified action type (e.g. "patient-engagement.appointment.book"). */
  actionType: string;
  /** The cartridge that owns this tool. */
  cartridgeId: string;
  /** Action definition from the cartridge manifest. */
  definition: ActionDefinition;
  /** Tool alias (if set by skin), otherwise undefined. */
  alias?: string;
}

/** Filter configuration for tool visibility (typically from a skin manifest). */
export interface ToolFilter {
  /** Glob patterns of action types to include (e.g. ["patient-engagement.*"]). */
  include: string[];
  /** Glob patterns of action types to exclude. */
  exclude?: string[];
  /** Map of alias names to canonical action types. */
  aliases?: Record<string, string>;
}
