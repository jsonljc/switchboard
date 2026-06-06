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
    identity?: { organizationId: string; contactId: string | null },
  ): Promise<{
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }> {
    // Spec-1A chain weld: key the thread off the resolver-provided contact/org
    // so the ConversationThread is the SAME row a booking later resolves
    // against. The visitor-/gateway literals remain ONLY as the fallback for a
    // session with no resolvable contact (identity absent or contactId null).
    const contactId = identity?.contactId ?? `visitor-${sessionId}`;
    const orgId = identity?.organizationId ?? "gateway";

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

    const direction = role === "user" ? "inbound" : "outbound";

    await this.prisma.conversationMessage.create({
      data: {
        contactId: info.contactId,
        orgId: info.organizationId,
        direction,
        content,
        channel: info.channel,
      },
    });

    const threadUpdate: {
      messageCount: { increment: number };
      lastWhatsAppInboundAt?: Date;
    } = { messageCount: { increment: 1 } };

    if (direction === "inbound" && info.channel === "whatsapp") {
      threadUpdate.lastWhatsAppInboundAt = new Date();
    }

    await this.prisma.conversationThread.update({
      where: { id: conversationId },
      data: threadUpdate,
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
