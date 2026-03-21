// ---------------------------------------------------------------------------
// Sales Closer — Dependency types (injected at construction time)
// ---------------------------------------------------------------------------

import type { LLMAdapter, ConversationStore } from "@switchboard/core";
import type { KnowledgeRetriever } from "../../knowledge/retrieval.js";

/**
 * Dependencies for LLM-powered conversation mode (message.received).
 * Optional — if not provided, message.received falls back to deterministic booking flow.
 */
export interface SalesCloserConversationDeps {
  llm: LLMAdapter;
  retriever: KnowledgeRetriever;
  conversationStore: ConversationStore;
}

/**
 * Callback to check if a specific agent is active for an org.
 * Used to determine whether Nurture is purchased before delegating cadences.
 */
export type AgentActiveCheck = (orgId: string, agentId: string) => boolean;

/**
 * Dependencies injected into the Sales Closer handler.
 */
export interface SalesCloserDeps {
  /** LLM-powered conversation dependencies (optional). */
  conversation?: SalesCloserConversationDeps;
  /** Check if an agent is active for an org (for Nurture fallback). */
  isAgentActive?: AgentActiveCheck;
}
