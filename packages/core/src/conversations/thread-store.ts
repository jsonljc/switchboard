import type {
  ConversationThread,
  ThreadStage,
  ThreadStatus,
  AgentContextData,
} from "@switchboard/schemas";

/**
 * Persistence interface for ConversationThread.
 * Implementations: PrismaConversationThreadStore (packages/db).
 */
export interface ConversationThreadStore {
  /** Load thread by contactId + orgId. Returns null if no thread exists. */
  getByContact(contactId: string, organizationId: string): Promise<ConversationThread | null>;

  /** Create a new thread. */
  create(thread: ConversationThread): Promise<void>;

  /** Update an existing thread. Partial — only provided fields are updated. */
  update(
    threadId: string,
    updates: {
      stage?: ThreadStage;
      threadStatus?: ThreadStatus;
      assignedAgent?: string;
      agentContext?: AgentContextData;
      currentSummary?: string;
      followUpSchedule?: ConversationThread["followUpSchedule"];
      lastOutcomeAt?: Date | null;
      messageCount?: number;
    },
  ): Promise<void>;
}
