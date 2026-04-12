// ---------------------------------------------------------------------------
// LLM Adapter — provider-agnostic conversational LLM interface
// ---------------------------------------------------------------------------
// Used by agent handlers for generating conversational replies with RAG context.
// Distinct from LLMClient (core/llm/types.ts) which handles structured completions.
// Implementations live in packages/agents/src/llm/ (Layer 5.5).
// ---------------------------------------------------------------------------

import type { Message } from "./conversation-store.js";
import type { ModelConfig } from "./model-router.js";

export interface RetrievedChunk {
  content: string;
  sourceType: "correction" | "wizard" | "document" | "learned";
  similarity: number;
  metadata?: Record<string, unknown>;
}

// Note: Thread context (AgentContextData) is deliberately NOT a field on ConversationPrompt.
// It's injected into agentInstructions as a text block by each agent's prompt builder,
// keeping this interface provider-agnostic and free of agent-specific concerns.
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
  generateReply(prompt: ConversationPrompt, modelConfig?: ModelConfig): Promise<LLMReply>;
}
