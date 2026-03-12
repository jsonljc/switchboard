import { randomUUID } from "node:crypto";
import type { ConversationStatus, LeadProfile } from "@switchboard/schemas";

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
  organizationId: string | null;
  status: ConversationStatus;
  currentIntent: string | null;
  pendingProposalIds: string[];
  pendingApprovalIds: string[];
  clarificationQuestion: string | null;
  messages: ConversationMessage[];
  firstReplyAt: Date | null;
  /** Timestamp of the last inbound (user) message. Used for WhatsApp 24h window enforcement. */
  lastInboundAt: Date | null;
  lastActivityAt: Date;
  expiresAt: Date;
  crmContactId: string | null;
  /** Typed lead profile that accumulates intelligence over conversation turns. */
  leadProfile: LeadProfile | null;
}

export function createConversation(
  threadId: string,
  channel: string,
  principalId: string,
  organizationId?: string | null,
): ConversationStateData {
  return {
    id: `conv_${randomUUID()}`,
    threadId,
    channel,
    principalId,
    organizationId: organizationId ?? null,
    status: "active",
    currentIntent: null,
    pendingProposalIds: [],
    pendingApprovalIds: [],
    clarificationQuestion: null,
    messages: [],
    firstReplyAt: null,
    lastInboundAt: null,
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    crmContactId: null,
    leadProfile: null,
  };
}

type ConversationAction =
  | { type: "set_clarifying"; question: string }
  | { type: "set_awaiting_approval"; approvalIds: string[] }
  | { type: "set_proposals"; proposalIds: string[] }
  | { type: "add_message"; message: ConversationMessage }
  | { type: "update_lead_profile"; profile: Partial<LeadProfile> }
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

    case "update_lead_profile":
      return {
        ...updated,
        leadProfile: { ...(updated.leadProfile ?? {}), ...action.profile },
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
