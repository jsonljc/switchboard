// ---------------------------------------------------------------------------
// Agent Port Interface — standard contract for hireable agents
// ---------------------------------------------------------------------------

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentPort {
  agentId: string;
  version: string;
  inboundEvents: string[];
  outboundEvents: string[];
  tools: ToolDeclaration[];
  configSchema: Record<string, unknown>;
  conversionActionTypes?: string[];
}

export interface AgentHandler {
  handle(
    event: import("./events.js").RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse>;
}

export interface AgentContext {
  organizationId: string;
  profile?: Record<string, unknown>;
  conversationHistory?: Array<{ role: string; content: string }>;
  contactData?: Record<string, unknown>;
}

export interface AgentResponse {
  events: import("./events.js").RoutedEventEnvelope[];
  actions: ActionRequest[];
  state?: Record<string, unknown>;
}

export interface ActionRequest {
  actionType: string;
  parameters: Record<string, unknown>;
}

export interface PortValidationResult {
  valid: boolean;
  errors: string[];
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
