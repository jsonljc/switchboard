// ---------------------------------------------------------------------------
// Lead Responder — Dependency types (injected at construction time)
// ---------------------------------------------------------------------------

import type { LLMAdapter, ConversationStore } from "@switchboard/core";
import type { KnowledgeRetriever } from "../../knowledge/retrieval.js";
import type { IngestionPipeline } from "../../knowledge/ingestion-pipeline.js";

/**
 * Lead scoring result. Mirrors the cartridge's LeadScoreResult
 * without creating a cross-layer import.
 */
export interface LeadScore {
  score: number;
  tier: "hot" | "warm" | "cool" | "cold";
  factors: Array<{ factor: string; contribution: number }>;
}

/**
 * Objection match result.
 */
export type ObjectionMatch =
  | { matched: true; category: string; response: string; followUp?: string }
  | { matched: false };

/**
 * FAQ match result.
 */
export type FAQMatch =
  | { matched: true; question: string; answer: string; confidence: number }
  | { matched: false };

/**
 * Dependencies for LLM-powered conversation mode (message.received).
 * All optional — if not provided, message.received falls back to scoring-only mode.
 */
export interface LeadResponderConversationDeps {
  llm: LLMAdapter;
  retriever: KnowledgeRetriever;
  conversationStore: ConversationStore;
  ingestionPipeline?: IngestionPipeline;
}

/**
 * Dependencies injected into the Lead Responder handler.
 * The app layer wires these from cartridge implementations.
 */
export interface LeadResponderDeps {
  /** Score a lead from event payload fields. Returns 0-100 score + tier. */
  scoreLead: (params: Record<string, unknown>) => LeadScore;

  /** Match objection text against known response trees. */
  matchObjection?: (text: string) => ObjectionMatch;

  /** Match message text against FAQ knowledge base. */
  matchFAQ?: (text: string) => FAQMatch;

  /** LLM-powered conversation dependencies (optional). */
  conversation?: LeadResponderConversationDeps;
}
