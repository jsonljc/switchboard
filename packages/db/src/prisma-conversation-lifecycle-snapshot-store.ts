import type { PrismaClient } from "@prisma/client";
import {
  ConversationLifecycleSnapshotSchema,
  type ConversationLifecycleSnapshot,
} from "@switchboard/schemas";
import type { LifecycleSnapshotStore } from "@switchboard/core";

export class PrismaConversationLifecycleSnapshotStore implements LifecycleSnapshotStore {
  constructor(private readonly prisma: PrismaClient) {}

  async read(threadId: string): Promise<ConversationLifecycleSnapshot | null> {
    const row = await this.prisma.conversationLifecycleSnapshot.findUnique({
      where: { conversationThreadId: threadId },
    });
    if (!row) return null;
    return ConversationLifecycleSnapshotSchema.parse(row);
  }

  async readInTransaction(
    tx: unknown,
    threadId: string,
  ): Promise<ConversationLifecycleSnapshot | null> {
    // tx is a Prisma TransactionClient; structurally identical to PrismaClient for the
    // models we touch, so a narrow cast is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txClient = tx as any;
    const row = await txClient.conversationLifecycleSnapshot.findUnique({
      where: { conversationThreadId: threadId },
    });
    if (!row) return null;
    return ConversationLifecycleSnapshotSchema.parse(row);
  }

  async upsertInTransaction(tx: unknown, snapshot: ConversationLifecycleSnapshot): Promise<void> {
    // tx is a Prisma TransactionClient; structurally identical to PrismaClient for the
    // models we touch, so a narrow cast is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txClient = tx as any;
    await txClient.conversationLifecycleSnapshot.upsert({
      where: { conversationThreadId: snapshot.conversationThreadId },
      create: {
        conversationThreadId: snapshot.conversationThreadId,
        organizationId: snapshot.organizationId,
        contactId: snapshot.contactId,
        currentState: snapshot.currentState,
        qualificationStatus: snapshot.qualificationStatus,
        bookingStatus: snapshot.bookingStatus,
        dropoffReason: snapshot.dropoffReason,
        lastTransitionAt: snapshot.lastTransitionAt,
        lastEvaluatedAt: snapshot.lastEvaluatedAt,
      },
      update: {
        currentState: snapshot.currentState,
        qualificationStatus: snapshot.qualificationStatus,
        bookingStatus: snapshot.bookingStatus,
        dropoffReason: snapshot.dropoffReason,
        lastTransitionAt: snapshot.lastTransitionAt,
        lastEvaluatedAt: snapshot.lastEvaluatedAt,
      },
    });
  }
}
