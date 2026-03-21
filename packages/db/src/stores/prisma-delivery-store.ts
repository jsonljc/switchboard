import type { PrismaClient } from "@prisma/client";

// Local interface matching @switchboard/agents DeliveryStore shape.
// We don't import from agents (Layer 5) to respect layer boundaries.
// Structural typing ensures compatibility when wired at the app layer (Layer 6).

type DeliveryStatus =
  | "pending"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "retrying"
  | "dead_letter"
  | "skipped";

interface DeliveryAttempt {
  eventId: string;
  destinationId: string;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt?: string;
  error?: string;
}

const DEFAULT_MAX_RETRIES = 3;

export class PrismaDeliveryStore {
  constructor(public readonly prisma: PrismaClient) {}

  async record(attempt: DeliveryAttempt): Promise<void> {
    await this.prisma.agentDeliveryAttempt.upsert({
      where: {
        eventId_destinationId: {
          eventId: attempt.eventId,
          destinationId: attempt.destinationId,
        },
      },
      create: {
        eventId: attempt.eventId,
        destinationId: attempt.destinationId,
        status: attempt.status,
        attempts: attempt.attempts,
        lastAttemptAt: attempt.lastAttemptAt ? new Date(attempt.lastAttemptAt) : null,
        error: attempt.error ?? null,
      },
      update: {
        status: attempt.status,
        attempts: attempt.attempts,
        lastAttemptAt: attempt.lastAttemptAt ? new Date(attempt.lastAttemptAt) : null,
        error: attempt.error ?? null,
      },
    });
  }

  async update(
    eventId: string,
    destinationId: string,
    updates: Partial<Pick<DeliveryAttempt, "status" | "attempts" | "error" | "lastAttemptAt">>,
  ): Promise<void> {
    await this.prisma.agentDeliveryAttempt.update({
      where: { eventId_destinationId: { eventId, destinationId } },
      data: {
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.attempts !== undefined && { attempts: updates.attempts }),
        ...(updates.error !== undefined && { error: updates.error }),
        ...(updates.lastAttemptAt !== undefined && {
          lastAttemptAt: updates.lastAttemptAt ? new Date(updates.lastAttemptAt) : null,
        }),
      },
    });
  }

  async getByEvent(eventId: string): Promise<DeliveryAttempt[]> {
    const rows = await this.prisma.agentDeliveryAttempt.findMany({
      where: { eventId },
    });
    return rows.map((r) => this.toDeliveryAttempt(r));
  }

  async listRetryable(): Promise<DeliveryAttempt[]> {
    const rows = await this.prisma.agentDeliveryAttempt.findMany({
      where: { status: { in: ["failed", "retrying"] } },
    });
    return rows.map((r) => this.toDeliveryAttempt(r));
  }

  async sweepDeadLetters(maxRetries: number = DEFAULT_MAX_RETRIES): Promise<number> {
    const result = await this.prisma.agentDeliveryAttempt.updateMany({
      where: {
        status: { in: ["failed", "retrying"] },
        attempts: { gte: maxRetries },
      },
      data: { status: "dead_letter" },
    });
    return result.count;
  }

  private toDeliveryAttempt(row: {
    eventId: string;
    destinationId: string;
    status: string;
    attempts: number;
    lastAttemptAt: Date | null;
    error: string | null;
  }): DeliveryAttempt {
    return {
      eventId: row.eventId,
      destinationId: row.destinationId,
      status: row.status as DeliveryStatus,
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt?.toISOString(),
      error: row.error ?? undefined,
    };
  }
}
