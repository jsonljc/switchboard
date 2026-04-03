// ---------------------------------------------------------------------------
// Agent Port Types — shared type definitions for agent contracts
// ---------------------------------------------------------------------------

import type { ConversationThread, ThreadStage, AgentContextData } from "./conversation-thread.js";
import type { OpportunityStage } from "./lifecycle.js";

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

export interface LifecycleAdvancer {
  advanceOpportunityStage(
    orgId: string,
    opportunityId: string,
    toStage: OpportunityStage,
    advancedBy: string,
  ): Promise<unknown>;
  reopenOpportunity(
    orgId: string,
    opportunityId: string,
    toStage: "interested" | "qualified",
  ): Promise<unknown>;
}

export interface AgentContext {
  organizationId: string;
  profile?: Record<string, unknown>;
  conversationHistory?: Array<{ role: string; content: string }>;
  contactData?: Record<string, unknown>;
  /** Loaded ConversationThread for this contact (if available). */
  thread?: ConversationThread;
  /** Optional lifecycle service for direct stage advancement. */
  lifecycle?: LifecycleAdvancer;
}

export interface ThreadUpdate {
  stage?: ThreadStage;
  assignedAgent?: string;
  agentContext?: AgentContextData;
  currentSummary?: string;
  messageCount?: number;
}

export interface ActionRequest {
  actionType: string;
  parameters: Record<string, unknown>;
}

export interface PortValidationResult {
  valid: boolean;
  errors: string[];
}
