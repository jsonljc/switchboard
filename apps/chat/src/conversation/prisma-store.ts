import type { PrismaClient } from "@switchboard/db";
import type { ConversationStateData } from "./state.js";
import type { ConversationStore } from "./store.js";
import type { ConversationStatus } from "@switchboard/schemas";

export class PrismaConversationStore implements ConversationStore {
  constructor(private prisma: PrismaClient) {}

  async get(threadId: string): Promise<ConversationStateData | undefined> {
    const row = await this.prisma.conversationState.findUnique({
      where: { threadId },
    });
    if (!row) return undefined;
    return toConversationStateData(row);
  }

  async save(state: ConversationStateData): Promise<void> {
    await this.prisma.conversationState.upsert({
      where: { threadId: state.threadId },
      create: {
        id: state.id,
        threadId: state.threadId,
        channel: state.channel,
        principalId: state.principalId,
        status: state.status,
        currentIntent: state.currentIntent,
        pendingProposalIds: state.pendingProposalIds,
        pendingApprovalIds: state.pendingApprovalIds,
        clarificationQuestion: state.clarificationQuestion,
        lastActivityAt: state.lastActivityAt,
        expiresAt: state.expiresAt,
      },
      update: {
        status: state.status,
        currentIntent: state.currentIntent,
        pendingProposalIds: state.pendingProposalIds,
        pendingApprovalIds: state.pendingApprovalIds,
        clarificationQuestion: state.clarificationQuestion,
        lastActivityAt: state.lastActivityAt,
        expiresAt: state.expiresAt,
      },
    });
  }

  async delete(threadId: string): Promise<void> {
    await this.prisma.conversationState.deleteMany({
      where: { threadId },
    });
  }

  async listActive(): Promise<ConversationStateData[]> {
    const rows = await this.prisma.conversationState.findMany({
      where: {
        status: { notIn: ["completed", "expired"] },
      },
    });
    return rows.map(toConversationStateData);
  }
}

function toConversationStateData(row: {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  status: string;
  currentIntent: string | null;
  pendingProposalIds: string[];
  pendingApprovalIds: string[];
  clarificationQuestion: string | null;
  lastActivityAt: Date;
  expiresAt: Date;
}): ConversationStateData {
  return {
    id: row.id,
    threadId: row.threadId,
    channel: row.channel,
    principalId: row.principalId,
    status: row.status as ConversationStatus,
    currentIntent: row.currentIntent,
    pendingProposalIds: row.pendingProposalIds,
    pendingApprovalIds: row.pendingApprovalIds,
    clarificationQuestion: row.clarificationQuestion,
    lastActivityAt: row.lastActivityAt,
    expiresAt: row.expiresAt,
  };
}
