// ---------------------------------------------------------------------------
// LLM Adapter — provider-agnostic conversational LLM interface
// ---------------------------------------------------------------------------
// Used by agent handlers for generating conversational replies with RAG context.
// Distinct from LLMClient (core/llm/types.ts) which handles structured completions.
// Implementations live in packages/agents/src/llm/ (Layer 5.5).
// ---------------------------------------------------------------------------

import type { Message } from "./conversation-store.js";

export interface RetrievedChunk {
  content: string;
  sourceType: "correction" | "wizard" | "document";
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationPrompt {
  systemPrompt: string;
  conversationHistory: Message[];
  retrievedContext: RetrievedChunk[];
  agentInstructions: string;
}

export interface LLMReply {
  reply: string;
  /** 0-1, below confidenceThreshold -> escalate. See design doc Section 6 for v1 limitations. */
  confidence: number;
}

export interface LLMAdapter {
  generateReply(prompt: ConversationPrompt): Promise<LLMReply>;
}
