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
      return { lastAlexOutboundAt: null, lastInboundAt: null };
    }
    const lastOutbound = await this.prisma.conversationMessage.findFirst({
      where: { contactId: thread.contactId, orgId: thread.organizationId, direction: "outbound" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const lastInbound = await this.prisma.conversationMessage.findFirst({
      where: { contactId: thread.contactId, orgId: thread.organizationId, direction: "inbound" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return {
      lastAlexOutboundAt: lastOutbound?.createdAt ?? null,
      lastInboundAt: lastInbound?.createdAt ?? null,
    };
  }
}
