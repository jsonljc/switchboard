// ---------------------------------------------------------------------------
// Handler Context — shared dependency interface for extracted handlers
// ---------------------------------------------------------------------------

import type { ChannelAdapter } from "../adapters/adapter.js";
import type { ResponseContext, GeneratedResponse } from "../composer/response-generator.js";
import type { ResponseHumanizer } from "../composer/humanize.js";
import type {
  RuntimeOrchestrator,
  StorageContext,
  CartridgeReadAdapter as CartridgeReadAdapterType,
} from "@switchboard/core";
import type { FailedMessageStore } from "../dlq/failed-message-store.js";

/** Mutable operator state tracked in-memory by ChatRuntime. */
export interface OperatorState {
  active: boolean;
  automationLevel: "copilot" | "supervised" | "autonomous";
}

export interface HandlerContext {
  adapter: ChannelAdapter;
  orchestrator: RuntimeOrchestrator;
  readAdapter: CartridgeReadAdapterType | null;
  storage: StorageContext | null;
  failedMessageStore: FailedMessageStore | null;
  humanizer: ResponseHumanizer;
  operatorState: OperatorState;

  /** Compose a user-facing response (LLM or template fallback). */
  composeResponse(context: ResponseContext, orgId?: string): Promise<GeneratedResponse>;
  /** Send text with banned phrase filtering. */
  sendFilteredReply(threadId: string, text: string): Promise<void>;
  /** Apply banned phrase filter to card text fields. */
  filterCardText<T extends { summary: string; explanation?: string }>(card: T): T;
  /** Record an assistant message in conversation thread. */
  recordAssistantMessage(threadId: string, text: string): Promise<void>;
  /** Track the last executed envelope for a thread. */
  trackLastExecuted(threadId: string, envelopeId: string): Promise<void>;
  /** Get the last executed envelope ID for undo. */
  getLastExecutedEnvelopeId(threadId: string): Promise<string | null>;
}
