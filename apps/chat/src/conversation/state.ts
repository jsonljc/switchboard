import { randomUUID } from "node:crypto";
import type { ConversationStatus } from "@switchboard/schemas";

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

export interface ConversationStateData {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  status: ConversationStatus;
  currentIntent: string | null;
  pendingProposalIds: string[];
  pendingApprovalIds: string[];
  clarificationQuestion: string | null;
  messages: ConversationMessage[];
  lastActivityAt: Date;
  expiresAt: Date;
}

export function createConversation(
  threadId: string,
  channel: string,
  principalId: string,
): ConversationStateData {
  return {
    id: `conv_${randomUUID()}`,
    threadId,
    channel,
    principalId,
    status: "active",
    currentIntent: null,
    pendingProposalIds: [],
    pendingApprovalIds: [],
    clarificationQuestion: null,
    messages: [],
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

type ConversationAction =
  | { type: "set_clarifying"; question: string }
  | { type: "set_awaiting_approval"; approvalIds: string[] }
  | { type: "set_proposals"; proposalIds: string[] }
  | { type: "add_message"; message: ConversationMessage }
  | { type: "complete" }
  | { type: "expire" }
  | { type: "resume" };

export function transitionConversation(
  state: ConversationStateData,
  action: ConversationAction,
): ConversationStateData {
  const updated = { ...state, lastActivityAt: new Date() };

  switch (action.type) {
    case "set_clarifying":
      return {
        ...updated,
        status: "awaiting_clarification",
        clarificationQuestion: action.question,
      };

    case "set_awaiting_approval":
      return {
        ...updated,
        status: "awaiting_approval",
        pendingApprovalIds: action.approvalIds,
      };

    case "set_proposals":
      return {
        ...updated,
        status: "active",
        pendingProposalIds: action.proposalIds,
        clarificationQuestion: null,
      };

    case "add_message":
      return {
        ...updated,
        messages: [...updated.messages, action.message],
      };

    case "complete":
      return { ...updated, status: "completed" };

    case "expire":
      return { ...updated, status: "expired" };

    case "resume":
      return {
        ...updated,
        status: "active",
        clarificationQuestion: null,
      };
  }
}
