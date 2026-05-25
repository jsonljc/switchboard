import type { PrismaDbClient } from "../prisma-db.js";

const MAX_ATTEMPTS = 10;

export class PrismaOutboxStore {
  constructor(private prisma: PrismaDbClient) {}

  /**
   * Idempotent enqueue. `eventId` is `@unique`, and callers derive it
   * deterministically from a domain row (e.g. `evt_rev_<revenueEventId>`).
   * A re-record of the same external payment therefore reuses the same
   * `eventId`. We insert via `createMany({ skipDuplicates: true })` so the
   * write becomes a SQL-level `ON CONFLICT DO NOTHING` — a duplicate is a
   * silent no-op rather than a thrown unique violation. This matters inside
   * the operator-mutation `$transaction`: a thrown P2002 there would abort
   * the whole transaction (and a bare try/catch could not recover a
   * Postgres tx mid-statement), turning a legitimate idempotent replay into
   * a 500. See #697.
   */
  async write(
    eventId: string,
    type: string,
    payload: Record<string, unknown>,
    tx?: PrismaDbClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.outboxEvent.createMany({
      data: [
        {
          eventId,
          type,
          payload: payload as Record<string, string | number | boolean | null>,
          status: "pending",
        },
      ],
      skipDuplicates: true,
    });
  }

  async fetchPending(limit: number) {
    return this.prisma.outboxEvent.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  async markPublished(id: string) {
    // route-governance: store-mutation-global — OutboxEvent is a system delivery
    // queue drained by the publisher worker; no organizationId binding.
    return this.prisma.outboxEvent.update({
      where: { id },
      data: { status: "published" },
    });
  }

  async recordFailure(id: string, attempts: number) {
    // route-governance: store-mutation-global — OutboxEvent is a system delivery
    // queue drained by the publisher worker; no organizationId binding.
    return this.prisma.outboxEvent.update({
      where: { id },
      data: {
        attempts,
        lastAttemptAt: new Date(),
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      },
    });
  }
}
