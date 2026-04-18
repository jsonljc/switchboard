import type { PrismaDbClient } from "../prisma-db.js";

const MAX_ATTEMPTS = 10;

export class PrismaOutboxStore {
  constructor(private prisma: PrismaDbClient) {}

  async write(eventId: string, type: string, payload: Record<string, unknown>) {
    return this.prisma.outboxEvent.create({
      data: {
        eventId,
        type,
        payload: payload as Record<string, string | number | boolean | null>,
        status: "pending",
      },
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
    return this.prisma.outboxEvent.update({
      where: { id },
      data: { status: "published" },
    });
  }

  async recordFailure(id: string, attempts: number) {
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
