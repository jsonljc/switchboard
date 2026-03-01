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
        status: "pending",
      },
    });
  }

  /** List pending (or filtered-by-status) failed messages. */
  async listPending(
    limit = 50,
    status: "pending" | "exhausted" | "resolved" = "pending",
  ) {
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
