import type { PrismaClient } from "@prisma/client";
import type {
  ScheduledFollowUpStore,
  CreateScheduledFollowUpInput,
  DueScheduledFollowUp,
} from "@switchboard/core";

const MAX_ATTEMPTS = 3;

export class PrismaScheduledFollowUpStore implements ScheduledFollowUpStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateScheduledFollowUpInput): Promise<{ id: string }> {
    const row = await this.prisma.scheduledFollowUp.create({
      data: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        conversationThreadId: input.conversationThreadId,
        sessionId: input.sessionId,
        deploymentId: input.deploymentId,
        workUnitId: input.workUnitId,
        channel: input.channel,
        jurisdiction: input.jurisdiction,
        reason: input.reason,
        templateIntentClass: input.templateIntentClass,
        dueAt: input.dueAt,
        dedupeKey: input.dedupeKey,
        status: "pending",
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async findPendingForContact(
    organizationId: string,
    contactId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.scheduledFollowUp.findFirst({
      where: { organizationId, contactId, status: "pending" },
      select: { id: true },
    });
  }

  async findDue(now: Date, limit: number): Promise<DueScheduledFollowUp[]> {
    return this.prisma.scheduledFollowUp.findMany({
      where: {
        status: "pending",
        dueAt: { lte: now },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { dueAt: "asc" },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        conversationThreadId: true,
        channel: true,
        templateIntentClass: true,
        reason: true,
        attempts: true,
      },
    });
  }

  async markSent(id: string): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledFollowUp.update({
      where: { id },
      data: { status: "sent", sentAt: new Date() },
    });
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledFollowUp.update({
      where: { id },
      data: { status: "skipped", skipReason: reason },
    });
  }

  async markFailed(id: string, error: string, nextRetryAt: Date | null): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledFollowUp.update({
      where: { id },
      data: nextRetryAt
        ? { status: "pending", attempts: { increment: 1 }, nextRetryAt, lastError: error }
        : { status: "failed", attempts: { increment: 1 }, lastError: error },
    });
  }
}
