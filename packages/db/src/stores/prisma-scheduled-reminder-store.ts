import type { PrismaClient } from "@prisma/client";
import type {
  CreateScheduledReminderInput,
  ScheduledReminderProbe,
  ScheduledReminderStore,
} from "@switchboard/core";

export class PrismaScheduledReminderStore implements ScheduledReminderStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateScheduledReminderInput): Promise<{ id: string }> {
    const row = await this.prisma.scheduledReminder.create({
      data: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        bookingId: input.bookingId,
        startsAt: input.startsAt,
        timezone: input.timezone,
        channel: input.channel,
        templateIntentClass: input.templateIntentClass,
        dedupeKey: input.dedupeKey,
        status: "pending",
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async findByDedupeKey(dedupeKey: string): Promise<ScheduledReminderProbe | null> {
    return this.prisma.scheduledReminder.findUnique({
      where: { dedupeKey },
      select: { id: true, status: true },
    });
  }

  async markSent(id: string): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledReminder.update({
      where: { id },
      data: { status: "sent", sentAt: new Date() },
    });
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledReminder.update({
      where: { id },
      data: { status: "skipped", skipReason: reason },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledReminder.update({
      where: { id },
      data: { status: "failed", lastError: error },
    });
  }
}
