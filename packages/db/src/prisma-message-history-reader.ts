import type { PrismaClient } from "@prisma/client";
import type { MessageHistoryReader } from "@switchboard/core";

export class PrismaMessageHistoryReader implements MessageHistoryReader {
  constructor(private readonly prisma: PrismaClient) {}

  async read(threadId: string) {
    const thread = await this.prisma.conversationThread.findUnique({
      where: { id: threadId },
      select: { contactId: true, organizationId: true },
    });
    if (!thread) {
      return { lastOutboundAt: null, lastInboundAt: null };
    }
    // The two reads are non-transactional by design. If an inbound arrives between
    // the queries, returning the newer inbound is the correct outcome — the thread
    // is reactivating and the cron will not mark it stalled.
    const [lastOutbound, lastInbound] = await Promise.all([
      this.prisma.conversationMessage.findFirst({
        where: { contactId: thread.contactId, orgId: thread.organizationId, direction: "outbound" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      this.prisma.conversationMessage.findFirst({
        where: { contactId: thread.contactId, orgId: thread.organizationId, direction: "inbound" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    return {
      lastOutboundAt: lastOutbound?.createdAt ?? null,
      lastInboundAt: lastInbound?.createdAt ?? null,
    };
  }
}
