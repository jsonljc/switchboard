import type { PrismaClient } from "@prisma/client";
import type { CreateRobinRecoverySendInput, RobinRecoverySendStore } from "@switchboard/core";

export class PrismaRobinRecoverySendStore implements RobinRecoverySendStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateRobinRecoverySendInput): Promise<{ id: string }> {
    // Claim-first INSERT; the unique dedupeKey makes a duplicate throw P2002, which the executor
    // swallows to SKIP (never re-send). The throw is intentional control flow, not an error here.
    const row = await this.prisma.robinRecoverySend.create({
      data: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        bookingId: input.bookingId,
        campaignKind: input.campaignKind,
        campaignWorkUnitId: input.campaignWorkUnitId ?? null,
        dedupeKey: input.dedupeKey,
        status: "pending",
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async markSent(id: string, messageId: string | null): Promise<void> {
    // route-governance: store-mutation-deferred. Single-row id-scoped update on our own freshly
    // minted uuid; org-scoping tracked for #643 (the org-scoped leg is the contact read at dispatch).
    await this.prisma.robinRecoverySend.update({
      where: { id },
      data: { status: "sent", sentAt: new Date(), messageId },
    });
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    // route-governance: store-mutation-deferred. Single-row id-scoped update on our own freshly
    // minted uuid; org-scoping tracked for #643 (the org-scoped leg is the contact read at dispatch).
    await this.prisma.robinRecoverySend.update({
      where: { id },
      data: { status: "skipped", skipReason: reason },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    // route-governance: store-mutation-deferred. Single-row id-scoped update on our own freshly
    // minted uuid; org-scoping tracked for #643 (the org-scoped leg is the contact read at dispatch).
    await this.prisma.robinRecoverySend.update({
      where: { id },
      data: { status: "failed", lastError: error },
    });
  }
}
