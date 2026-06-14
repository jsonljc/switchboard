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

// Discriminated target for releasing an escalation back to the AI. The two
// producer paths key the transcript differently:
//   - escalate-tool handoffs resolve a Contact (ConversationMessage transcript +
//     Contact-keyed delivery);
//   - gateway pre-input-gate handoffs key a phone-threaded ConversationState
//     (the historical behavior, unchanged).
export type ReleaseEscalationTarget = { contactId: string } | { threadId: string };

export interface ReleaseEscalationInput {
  organizationId: string;
  handoffId: string;
  operator: Actor;
  reply: { text: string };
  target: ReleaseEscalationTarget;
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

// Thrown when the escalate-tool release target resolves a contactId that has no
// Contact row (a genuine data gap, distinct from a missing ConversationState).
// The reply route maps this to 502 ("reply saved, delivery unresolved"), not
// 404, so it is never confused with handoff-not-found / wrong-org.
export class ContactNotFoundError extends Error {
  readonly kind = "contact_not_found" as const;
  constructor(public readonly contactId: string) {
    super(`Contact not found for contactId="${contactId}"`);
    this.name = "ContactNotFoundError";
  }
}

export class ConversationStateInvalidTransitionError extends Error {
  readonly kind = "conversation_state_invalid_transition" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConversationStateInvalidTransitionError";
  }
}
