// ---------------------------------------------------------------------------
// Agent Port Interface — standard contract for hireable agents
// ---------------------------------------------------------------------------

// Re-export shared types from schemas (Layer 1)
export type {
  ToolDeclaration,
  AgentPort,
  LifecycleAdvancer,
  AgentContext,
  ThreadUpdate,
  ActionRequest,
  PortValidationResult,
} from "@switchboard/schemas";

import type {
  ActionRequest,
  AgentContext,
  PortValidationResult,
  AgentPort,
  ThreadUpdate,
} from "@switchboard/schemas";

export interface AgentHandler {
  handle(
    event: import("./events.js").RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse>;
}

export interface AgentResponse {
  events: import("./events.js").RoutedEventEnvelope[];
  actions: ActionRequest[];
  state?: Record<string, unknown>;
  /** Thread updates to persist after processing. */
  threadUpdate?: ThreadUpdate;
}

export function validateAgentPort(port: AgentPort): PortValidationResult {
  const errors: string[] = [];

  if (!port.agentId || port.agentId.trim() === "") {
    errors.push("agentId must not be empty");
  }

  if (!port.version || port.version.trim() === "") {
    errors.push("version must not be empty");
  }

  if (!port.inboundEvents || port.inboundEvents.length === 0) {
    errors.push("inboundEvents must have at least one event");
  }

  return { valid: errors.length === 0, errors };
}
