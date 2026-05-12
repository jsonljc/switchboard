import type { PrismaClient } from "@prisma/client";
import {
  ConversationLifecycleTransitionSchema,
  type ConversationLifecycleTransition,
} from "@switchboard/schemas";
import type { LifecycleTransitionStore } from "@switchboard/core";

export class PrismaConversationLifecycleTransitionStore implements LifecycleTransitionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async appendInTransaction(
    tx: unknown,
    transition: Omit<ConversationLifecycleTransition, "id">,
  ): Promise<void> {
    // tx is a Prisma TransactionClient; structurally identical to PrismaClient for the
    // models we touch, so a narrow cast is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txClient = tx as any;
    await txClient.conversationLifecycleTransition.create({
      data: {
        // id omitted — Prisma @default(cuid()) generates it
        organizationId: transition.organizationId,
        conversationThreadId: transition.conversationThreadId,
        contactId: transition.contactId,
        fromState: transition.fromState,
        toState: transition.toState,
        trigger: transition.trigger,
        evidence: transition.evidence,
        actor: transition.actor,
        workTraceId: transition.workTraceId,
        occurredAt: transition.occurredAt,
      },
    });
  }

  async listForThread(threadId: string): Promise<ConversationLifecycleTransition[]> {
    const rows = await this.prisma.conversationLifecycleTransition.findMany({
      where: { conversationThreadId: threadId },
      orderBy: { occurredAt: "asc" },
    });
    return rows.map((r: unknown) => ConversationLifecycleTransitionSchema.parse(r));
  }

  async findLatestProposal(
    conversationThreadId: string,
  ): Promise<ConversationLifecycleTransition | null> {
    const row = await this.prisma.conversationLifecycleTransition.findFirst({
      where: {
        conversationThreadId,
        trigger: "system_proposed_disqualification",
      },
      orderBy: { occurredAt: "desc" },
    });
    return row ? ConversationLifecycleTransitionSchema.parse(row) : null;
  }
}
