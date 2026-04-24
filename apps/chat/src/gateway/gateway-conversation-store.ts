import type { PrismaClient } from "@switchboard/db";
import type { GatewayConversationStore } from "@switchboard/core";

interface ThreadInfo {
  contactId: string;
  organizationId: string;
  channel: string;
}

export class PrismaGatewayConversationStore implements GatewayConversationStore {
  private threadCache = new Map<string, ThreadInfo>();

  constructor(private prisma: PrismaClient) {}

  async getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
  ): Promise<{
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }> {
    const contactId = `visitor-${sessionId}`;
    const orgId = "gateway";

    let thread = await this.prisma.conversationThread.findFirst({
      where: {
        agentContext: {
          path: ["deploymentId"],
          equals: deploymentId,
        },
        AND: [
          { agentContext: { path: ["sessionId"], equals: sessionId } },
          { agentContext: { path: ["channel"], equals: channel } },
        ],
      },
    });

    if (!thread) {
      thread = await this.prisma.conversationThread.create({
        data: {
          contactId,
          organizationId: orgId,
          agentContext: { deploymentId, sessionId, channel },
          followUpSchedule: {},
        },
      });
    }

    this.threadCache.set(thread.id, { contactId, organizationId: orgId, channel });

    const rawMessages = await this.prisma.conversationMessage.findMany({
      where: { contactId, orgId },
      orderBy: { createdAt: "asc" },
    });

    const messages = rawMessages.map((m) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.content,
    }));

    return { conversationId: thread.id, messages };
  }

  async addMessage(conversationId: string, role: string, content: string): Promise<void> {
    const info = this.threadCache.get(conversationId);
    if (!info) {
      throw new Error(
        `Thread ${conversationId} not found in cache — call getOrCreateBySession first`,
      );
    }

    await this.prisma.conversationMessage.create({
      data: {
        contactId: info.contactId,
        orgId: info.organizationId,
        direction: role === "user" ? "inbound" : "outbound",
        content,
        channel: info.channel,
      },
    });

    await this.prisma.conversationThread.update({
      where: { id: conversationId },
      data: { messageCount: { increment: 1 } },
    });
  }

  async getConversationStatus(sessionId: string): Promise<string | null> {
    const row = await this.prisma.conversationState.findUnique({
      where: { threadId: sessionId },
      select: { status: true },
    });
    return row?.status ?? null;
  }
}
