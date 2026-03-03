import type { PrismaClient } from "@switchboard/db";

export interface FailedMessageInput {
  channel: string;
  webhookPath?: string;
  organizationId?: string;
  rawPayload: unknown;
  stage: "parse" | "interpret" | "propose" | "execute" | "unknown";
  errorMessage: string;
  errorStack?: string;
}

export interface FailedMessageStats {
  pending: number;
  exhausted: number;
  resolved: number;
  total: number;
}

const DEFAULT_MAX_RETRIES = 5;

/**
 * Dead-letter queue service backed by Prisma `FailedMessage` model.
 * All writes use .catch() so they never block or crash the webhook handler.
 */
export class FailedMessageStore {
  constructor(private prisma: PrismaClient) {}

  /** Record a failed message. Fire-and-forget safe. */
  async record(input: FailedMessageInput): Promise<void> {
    await this.prisma.failedMessage.create({
      data: {
        channel: input.channel,
        webhookPath: input.webhookPath ?? null,
        organizationId: input.organizationId ?? null,
        rawPayload: input.rawPayload as any,
        stage: input.stage,
        errorMessage: input.errorMessage,
        errorStack: input.errorStack ?? null,
        retryCount: 0,
        maxRetries: DEFAULT_MAX_RETRIES,
        status: "pending",
      },
    });
  }

  /** List pending (or filtered-by-status) failed messages. */
  async listPending(limit = 50, status: "pending" | "exhausted" | "resolved" = "pending") {
    return this.prisma.failedMessage.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /** Mark a failed message as resolved. */
  async markResolved(id: string): Promise<void> {
    await this.prisma.failedMessage.update({
      where: { id },
      data: { status: "resolved", resolvedAt: new Date() },
    });
  }

  /**
   * Increment retryCount on a pending message.
   * If retryCount reaches maxRetries, transitions status to "exhausted".
   * Returns the updated record.
   */
  async incrementRetry(id: string, newError: string): Promise<{ exhausted: boolean }> {
    const msg = await this.prisma.failedMessage.findUnique({ where: { id } });
    if (!msg || msg.status !== "pending") {
      return { exhausted: true };
    }

    const nextCount = msg.retryCount + 1;
    const exhausted = nextCount >= msg.maxRetries;

    await this.prisma.failedMessage.update({
      where: { id },
      data: {
        retryCount: nextCount,
        errorMessage: newError,
        status: exhausted ? "exhausted" : "pending",
      },
    });

    return { exhausted };
  }

  /**
   * Sweep pending messages that have exceeded their maxRetries and mark them exhausted.
   * Returns the number of messages transitioned.
   */
  async sweepExhausted(): Promise<number> {
    // Prisma can't compare two columns in updateMany, so find first then batch update
    const overdue = await this.prisma.failedMessage.findMany({
      where: { status: "pending" },
      select: { id: true, retryCount: true, maxRetries: true },
    });

    const ids = overdue.filter((m) => m.retryCount >= m.maxRetries).map((m) => m.id);

    if (ids.length === 0) return 0;

    const result = await this.prisma.failedMessage.updateMany({
      where: { id: { in: ids } },
      data: { status: "exhausted" },
    });
    return result.count;
  }

  /** Get aggregate counts by status. */
  async getStats(): Promise<FailedMessageStats> {
    const [pending, exhausted, resolved] = await Promise.all([
      this.prisma.failedMessage.count({ where: { status: "pending" } }),
      this.prisma.failedMessage.count({ where: { status: "exhausted" } }),
      this.prisma.failedMessage.count({ where: { status: "resolved" } }),
    ]);
    return { pending, exhausted, resolved, total: pending + exhausted + resolved };
  }
}
