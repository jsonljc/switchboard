import type { PrismaClient } from "@prisma/client";

// Local interfaces matching @switchboard/core ConversationThreadStore shape.
// Structural typing — no cross-layer import.

type ThreadStage =
  | "new"
  | "responding"
  | "qualifying"
  | "qualified"
  | "closing"
  | "won"
  | "lost"
  | "nurturing";

type ThreadStatus = "open" | "waiting_on_customer" | "waiting_on_business" | "stale" | "closed";

type SentimentTrend = "positive" | "neutral" | "negative" | "unknown";

interface AgentContextData {
  objectionsEncountered: string[];
  preferencesLearned: Record<string, string>;
  offersMade: Array<{ description: string; date: Date }>;
  topicsDiscussed: string[];
  sentimentTrend: SentimentTrend;
}

interface FollowUpSchedule {
  nextFollowUpAt: Date | null;
  reason: string | null;
  cadenceId: string | null;
}

interface ConversationThread {
  id: string;
  contactId: string;
  organizationId: string;
  stage: ThreadStage;
  threadStatus: ThreadStatus;
  assignedAgent: string;
  agentContext: AgentContextData;
  currentSummary: string;
  followUpSchedule: FollowUpSchedule;
  lastOutcomeAt: Date | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaConversationThreadStore {
  constructor(private prisma: PrismaClient) {}

  async getByContact(
    contactId: string,
    organizationId: string,
  ): Promise<ConversationThread | null> {
    const row = await this.prisma.conversationThread.findUnique({
      where: { contactId_organizationId: { contactId, organizationId } },
    });

    if (!row) return null;

    return {
      id: row.id,
      contactId: row.contactId,
      organizationId: row.organizationId,
      stage: row.stage as ThreadStage,
      threadStatus: row.threadStatus as ThreadStatus,
      assignedAgent: row.assignedAgent,
      agentContext: row.agentContext as unknown as AgentContextData,
      currentSummary: row.currentSummary,
      followUpSchedule: row.followUpSchedule as unknown as FollowUpSchedule,
      lastOutcomeAt: row.lastOutcomeAt,
      messageCount: row.messageCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(thread: ConversationThread): Promise<void> {
    await this.prisma.conversationThread.create({
      data: {
        id: thread.id,
        contactId: thread.contactId,
        organizationId: thread.organizationId,
        stage: thread.stage,
        threadStatus: thread.threadStatus,
        assignedAgent: thread.assignedAgent,
        agentContext: thread.agentContext as object,
        currentSummary: thread.currentSummary,
        followUpSchedule: thread.followUpSchedule as object,
        lastOutcomeAt: thread.lastOutcomeAt,
        messageCount: thread.messageCount,
      },
    });
  }

  async update(
    threadId: string,
    updates: {
      stage?: ThreadStage;
      threadStatus?: ThreadStatus;
      assignedAgent?: string;
      agentContext?: AgentContextData;
      currentSummary?: string;
      followUpSchedule?: FollowUpSchedule;
      lastOutcomeAt?: Date | null;
      messageCount?: number;
    },
  ): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.stage !== undefined) data.stage = updates.stage;
    if (updates.threadStatus !== undefined) data.threadStatus = updates.threadStatus;
    if (updates.assignedAgent !== undefined) data.assignedAgent = updates.assignedAgent;
    if (updates.agentContext !== undefined) data.agentContext = updates.agentContext as object;
    if (updates.currentSummary !== undefined) data.currentSummary = updates.currentSummary;
    if (updates.followUpSchedule !== undefined)
      data.followUpSchedule = updates.followUpSchedule as object;
    if (updates.lastOutcomeAt !== undefined) data.lastOutcomeAt = updates.lastOutcomeAt;
    if (updates.messageCount !== undefined) data.messageCount = updates.messageCount;

    await this.prisma.conversationThread.update({
      where: { id: threadId },
      data,
    });
  }
}
