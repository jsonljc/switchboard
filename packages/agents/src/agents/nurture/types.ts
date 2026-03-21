// ---------------------------------------------------------------------------
// Nurture Agent — Dependency types (injected at construction time)
// ---------------------------------------------------------------------------

import type { LLMAdapter, ConversationStore } from "@switchboard/core";
import type { KnowledgeRetriever } from "../../knowledge/retrieval.js";

/**
 * Dependencies for LLM-generated cadence messages.
 * Optional — if not provided, cadence messages use static templates.
 */
export interface NurtureConversationDeps {
  llm: LLMAdapter;
  retriever: KnowledgeRetriever;
  conversationStore: ConversationStore;
}

/**
 * Dependencies injected into the Nurture handler.
 */
export interface NurtureDeps {
  /** LLM-powered cadence message generation (optional). */
  conversation?: NurtureConversationDeps;
}
