import type { PrismaClient } from "@prisma/client";
import { dayWindow } from "@switchboard/schemas";

/**
 * Read-only store for ConversationState. Used by dashboards / metrics that don't need
 * the WorkTrace integration of the full PrismaConversationStateStore.
 */
export class PrismaConversationStateReadStore {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Median first-reply latency (in seconds) for conversations created on `day`,
   * counting only those where firstReplyAt exists AND (firstReplyAt - createdAt) <= 24h.
   * Returns { medianSeconds: 0, sampleSize: 0 } when no eligible rows.
   *
   * Callers should compare sampleSize against MIN_REPLY_SAMPLE from
   * `@switchboard/schemas` before surfacing the median as a headline metric.
   */
  async replyTimeStats(
    orgId: string,
    day: Date,
  ): Promise<{ medianSeconds: number; sampleSize: number }> {
    const { from: dayStart, to: dayEnd } = dayWindow(day);
    const slaCutoffMs = 24 * 60 * 60 * 1000;

    const rows = await this.prisma.conversationState.findMany({
      where: {
        organizationId: orgId,
        createdAt: { gte: dayStart, lt: dayEnd },
        firstReplyAt: { not: null },
      },
      select: { createdAt: true, firstReplyAt: true },
    });

    const latencies: number[] = [];
    for (const row of rows) {
      if (!row.firstReplyAt) continue;
      const ms = row.firstReplyAt.getTime() - row.createdAt.getTime();
      if (ms < 0 || ms > slaCutoffMs) continue;
      latencies.push(Math.round(ms / 1000));
    }

    if (latencies.length === 0) return { medianSeconds: 0, sampleSize: 0 };
    latencies.sort((a, b) => a - b);
    const mid = Math.floor(latencies.length / 2);
    const medianSeconds =
      latencies.length % 2 === 0
        ? Math.round((latencies[mid - 1]! + latencies[mid]!) / 2)
        : latencies[mid]!;
    return { medianSeconds, sampleSize: latencies.length };
  }
}
