import type { Actor } from "./types.js";

export type ConversationOperatorActionKind =
  | "conversation.override.set"
  | "conversation.message.send"
  | "escalation.reply.release_to_ai";

export interface SetOverrideInput {
  organizationId: string;
  threadId: string;
  override: boolean;
  operator: Actor;
}

export interface SetOverrideResult {
  conversationId: string;
  threadId: string;
  status: string;
  workTraceId: string;
}

export interface SendOperatorMessageInput {
  organizationId: string;
  threadId: string;
  operator: Actor;
  message: { text: string };
}

export interface SendOperatorMessageResult {
  conversationId: string;
  threadId: string;
  channel: string;
  destinationPrincipalId: string;
  workTraceId: string;
  appendedMessage: { role: "owner"; text: string; timestamp: string };
}

export interface ReleaseEscalationInput {
  organizationId: string;
  handoffId: string;
  threadId: string;
  operator: Actor;
  reply: { text: string };
}

export interface ReleaseEscalationResult {
  conversationId: string;
  threadId: string;
  channel: string;
  destinationPrincipalId: string;
  workTraceId: string;
  appendedReply: { role: "owner"; text: string; timestamp: string };
}

export interface ConversationStateStore {
  setOverride(input: SetOverrideInput): Promise<SetOverrideResult>;
  sendOperatorMessage(input: SendOperatorMessageInput): Promise<SendOperatorMessageResult>;
  releaseEscalationToAi(input: ReleaseEscalationInput): Promise<ReleaseEscalationResult>;
}

export class ConversationStateNotFoundError extends Error {
  readonly kind = "conversation_state_not_found" as const;
  constructor(public readonly threadId: string) {
    super(`ConversationState not found for threadId="${threadId}"`);
    this.name = "ConversationStateNotFoundError";
  }
}

export class ConversationStateInvalidTransitionError extends Error {
  readonly kind = "conversation_state_invalid_transition" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConversationStateInvalidTransitionError";
  }
}
